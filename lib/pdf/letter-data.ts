import type {
  Contact,
  Contribution,
  OrgSettings,
  PublicCharityStatus,
  StockContributionDetail,
} from '@/lib/supabase/types/database'
import { formatCents } from '@/lib/utils/money'
import { formatDateLong } from '@/lib/utils/dates'
import {
  letterTemplateGroup,
  renderLetterTemplate,
  resolveLetterTemplate,
  sponsorFallback,
  type LetterPlaceholder,
} from './letter-templates'

/**
 * Builds the frozen data snapshot an acknowledgement letter is rendered from.
 * A pure function, so each wording branch is unit-tested (letter-data.test.ts).
 *
 * Basis: IRS Publication 1771 (Charitable Contributions: Substantiation and
 * Disclosure Requirements) and IRC §170(f)(8): the organization's name, the
 * cash amount or a description (not a value) of non-cash property, and
 * whether any goods or services were provided, with a good-faith estimate of
 * their value when they were (§6115 quid pro quo disclosure). Vehicle
 * variants cite IRS Pub 526, Pub 590-B and the IRC sections noted inline.
 *
 * This wording is a starting point, not legal advice: each organization
 * should have its own accountant or counsel review it before use.
 */

export interface LetterData {
  /** Full legal name, e.g. "Example Foundation Inc." */
  orgLegalName: string
  /** Defined short name used in the body, e.g. "Example Foundation" */
  orgShortName: string
  ein: string
  orgAddressLines: string[]
  letterDate: string
  /** Recipient block above the salutation: donor name then address lines */
  recipientLines: string[]
  /** e.g. "Dear Jane:" */
  salutation: string
  /** Opening paragraph thanking the donor and describing the gift */
  giftParagraph: string
  /** 501(c)(3) status (with the org's IRS classification) and, per vehicle, deductibility */
  deductibilityParagraph: string
  /** No-goods-or-services statement, or the quid pro quo variant */
  goodsServicesParagraph: string
  /** Non-cash gifts only: states the letter does not assign a value */
  inKindNote: string | null
  closingLine: string
  signatoryName: string
  /** e.g. "President, Example Foundation Inc." */
  signatoryTitle: string
}

// Pub 1771: describe non-cash property, but the charity doesn't value it.
const IN_KIND_NOTE =
  'This letter describes the donated property only and does not state its value. ' +
  'Determining the property’s fair market value is the donor’s responsibility.'

/** Strip a corporate suffix for the short reference name: "Example Fund Inc." -> "Example Fund". */
function shortName(legalName: string): string {
  const stripped = legalName
    .replace(/,?\s+(inc\.?|llc|l\.l\.c\.|corp\.?|corporation|co\.?|company|foundation|ltd\.?)$/i, '')
    .trim()
  return stripped || legalName
}

/** Standard US "City, ST ZIP" line, omitting blank parts. */
function cityStateZip(
  city: string | null,
  state: string | null,
  postal: string | null
): string | null {
  const left = (city ?? '').replace(/,\s*$/, '').trim()
  const right = [state, postal].filter(Boolean).join(' ').trim()
  const line = [left, right].filter(Boolean).join(', ')
  return line || null
}

function formatShares(shares: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(shares)
}

function stockDescription(stockDetail: StockContributionDetail | null | undefined): string {
  if (!stockDetail) {
    throw new Error('Stock contribution details are required before generating letters.')
  }
  const ticker = stockDetail.ticker_symbol ? ` (${stockDetail.ticker_symbol})` : ''
  const cusip = stockDetail.cusip ? `, CUSIP ${stockDetail.cusip}` : ''
  return `${formatShares(stockDetail.shares)} shares of ${stockDetail.security_name}${ticker}${cusip}`
}

/**
 * The status sentence. 501(c)(3) recognition is always stated; the second
 * clause names the classification from Settings → Organization
 * (org_settings.public_charity_status), and is left out when it isn't set
 * rather than assuming one. Classifications per IRC §509(a) and §170(b)(1)(A);
 * a private foundation is still a §170(c) donee (IRS Pub 526, "Organizations
 * That Qualify To Receive Deductible Contributions").
 */
const CLASSIFICATION_CLAUSES: Record<PublicCharityStatus, string> = {
  '509a1': 'a public charity described in Section 509(a)(1) of the Code',
  '509a2': 'a public charity described in Section 509(a)(2) of the Code',
  '509a3': 'a supporting organization described in Section 509(a)(3) of the Code',
  private_foundation: 'a private foundation within the meaning of Section 509(a) of the Code',
}

export function statusSentence(
  orgLegalName: string,
  status: PublicCharityStatus | null | undefined
): string {
  const base =
    `${orgLegalName} is a tax-exempt organization described in Section 501(c)(3) of the ` +
    'Internal Revenue Code (the “Code”)'
  return status ? `${base} and is ${CLASSIFICATION_CLAUSES[status]}.` : `${base}.`
}

/** Vehicles whose gift can't carry goods or services back to the donor (also a DB CHECK). */
function vehicleForbidsBenefits(vehicle: Contribution['vehicle']): boolean {
  return vehicle === 'daf' || vehicle === 'ira_qcd'
}

export function buildLetterData(
  contribution: Contribution,
  contact: Contact,
  settings: OrgSettings,
  letterDate: string,
  stockDetail?: StockContributionDetail | null,
  /** Organization donors: the person the letter is addressed to (primary affiliation) */
  attention?: Pick<Contact, 'first_name' | 'last_name' | 'display_name'> | null
): LetterData {
  if (!settings.org_legal_name) {
    throw new Error(
      'Organization legal name is not set. Add it in Settings before generating letters.'
    )
  }
  if (!settings.ein) {
    throw new Error('Organization EIN is not set. Add it in Settings before generating letters.')
  }
  if (!settings.letter_signatory_name) {
    throw new Error('Letter signatory is not set. Add it in Settings before generating letters.')
  }

  const orgLegalName = settings.org_legal_name
  const orgShortName = settings.org_display_name?.trim() || shortName(orgLegalName)

  const isOrg = contact.kind === 'organization'
  // Name the donor by their official/legal name on the letter, not an
  // short app label: prefer the legal name when one is on file.
  const donorName = contact.legal_name?.trim() || contact.display_name

  const orgAddressLines = [
    settings.address_line1,
    settings.address_line2,
    cityStateZip(settings.city, settings.state, settings.postal_code),
    settings.country && settings.country !== 'US' ? settings.country : null,
  ].filter((line): line is string => Boolean(line))

  // Recipient block: donor name, an "Attention:" line for an organization
  // donor's contact person, and the contact email (letters go out by email).
  const person = isOrg ? attention ?? null : contact
  const contactPerson = person?.display_name?.trim() ?? ''
  const recipientLines = [donorName]
  if (isOrg && contactPerson) recipientLines.push(`Attention: ${contactPerson}`)
  if (contact.email) recipientLines.push(`Email: ${contact.email}`)

  const greetName = person?.first_name?.trim() || donorName
  const salutation = `Dear ${greetName}:`

  const isNonCash = contribution.method === 'in_kind' || contribution.method === 'stock'

  let giftClause: string
  if (contribution.method === 'stock') {
    giftClause = stockDescription(stockDetail)
  } else if (contribution.method === 'in_kind') {
    giftClause = contribution.in_kind_description ?? 'in-kind property'
  } else {
    giftClause = `${formatCents(contribution.amount_cents)} USD`
  }

  const vehicle = contribution.vehicle
  const sponsor = contribution.vehicle_sponsor_name?.trim() || null
  if (contribution.quid_pro_quo && vehicleForbidsBenefits(vehicle)) {
    // The database CHECK vehicle_no_quid_pro_quo already blocks this.
    throw new Error(
      'A donor-advised fund grant or IRA qualified charitable distribution cannot include goods or services to the donor.'
    )
  }

  // Opening and tax paragraphs: the organization's own wording from
  // Settings (org_settings.letter_templates), else the defaults in
  // letter-templates.ts. Read at generation time; a sent letter keeps the
  // body_snapshot it was generated with.
  const group = letterTemplateGroup(vehicle)
  const template = resolveLetterTemplate(group, settings.letter_templates)
  const values: Record<LetterPlaceholder, string> = {
    orgLegalName,
    orgShortName,
    donor: donorName,
    sponsor: sponsor ?? sponsorFallback(group, donorName),
    gift: giftClause,
    date: formatDateLong(contribution.received_date),
  }
  const giftParagraph = renderLetterTemplate(template.opening, values)
  const taxText = renderLetterTemplate(template.tax, values)
  // The status sentence is always stated; the classification only when set
  const status = statusSentence(orgLegalName, settings.public_charity_status)
  const deductibilityParagraph = taxText ? `${status} ${taxText}` : status

  // Pub 1771 / IRC §170(f)(8)(B)(ii)-(iii) and §6115: say whether anything
  // was given in return and, if so, describe it with a good-faith estimate.
  const keepLetter = 'We recommend keeping this letter with your tax records.'
  let goodsServicesParagraph: string
  if (contribution.quid_pro_quo) {
    const value = formatCents(contribution.goods_services_value_cents)
    goodsServicesParagraph =
      `In return for this gift, ${orgShortName} provided ${contribution.goods_services_description}. ` +
      `Our good-faith estimate of their value is ${value}. Only the part of the gift that is ` +
      'more than that value can be deducted for federal income tax purposes. ' +
      keepLetter
  } else if (vehicle === 'daf') {
    // IRC §4967: a donor or advisor may receive no more than an incidental
    // benefit from a donor-advised fund grant.
    goodsServicesParagraph =
      `${orgShortName} did not provide any goods or services, to you or to anyone else, in ` +
      `exchange for this grant. ${keepLetter}`
  } else if (vehicle === 'ira_qcd') {
    // Pub 590-B: only a distribution that would otherwise be fully
    // deductible qualifies, so nothing may be received in return.
    goodsServicesParagraph =
      `${orgShortName} did not provide any goods or services in exchange for this ` +
      `distribution. ${keepLetter}`
  } else {
    goodsServicesParagraph =
      `${orgShortName} did not provide any goods or services in exchange for this gift. ` +
      keepLetter
  }

  const signatoryTitle = settings.letter_signatory_title
    ? `${settings.letter_signatory_title}, ${orgLegalName}`
    : orgLegalName

  return {
    orgLegalName,
    orgShortName,
    ein: settings.ein,
    orgAddressLines,
    letterDate: formatDateLong(letterDate),
    recipientLines,
    salutation,
    giftParagraph,
    deductibilityParagraph,
    goodsServicesParagraph,
    inKindNote: isNonCash ? IN_KIND_NOTE : null,
    closingLine: settings.letter_closing_text,
    signatoryName: settings.letter_signatory_name,
    signatoryTitle,
  }
}
