import type {
  Contact,
  Disbursement,
  GrantOut,
  GrantProposal,
  OrgSettings,
  ProposalMemo,
} from '@/lib/supabase/types/database'
import { MEMO_SECTION_FIELDS } from '@/lib/grants/memo'
import { formatCents } from '@/lib/utils/money'
import { formatDateLong } from '@/lib/utils/dates'

/**
 * Builds the frozen data snapshot a Grant Memorandum PDF is rendered from.
 * Pure function (unit-tested in memo-data.test.ts): the header table rows are
 * derived from record data, the numbered sections come straight from the memo.
 */

export interface MemoData {
  /** Document title; defaults to "Grant Memorandum" when absent */
  title?: string
  orgLegalName: string
  /** e.g. "Example Foundation Inc. - Grant Record" */
  subtitle: string
  /** Long-form generation date shown under the title */
  generatedDate: string
  /** Used for the PDF document title */
  granteeName: string
  headerRows: { label: string; lines: string[] }[]
  sections: { number: number; heading: string; body: string }[]
}

const EMPTY = '—'

/** Memoranda carry the organization's legal name; refuse to build without it. */
export function requireLegalName(settings: Pick<OrgSettings, 'org_legal_name'>): string {
  const name = settings.org_legal_name?.trim()
  if (!name) {
    throw new Error(
      'Organization legal name is not set. Add it in Settings before generating memoranda.'
    )
  }
  return name
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

/** The person named as a recipient organization's principal contact */
export type PrincipalContact = Pick<Contact, 'display_name' | 'email'>

/**
 * The header's tax-status sentence, e.g.
 * "Tax-exempt under Section 501(c)(3); public charity described in
 *  Sections 509(a)(1)–(3). EIN 00-0000000."
 */
export function formatTaxStatusLine(
  details: Pick<Contact, 'tax_status' | 'tax_id'> | null
): string {
  if (!details || (!details.tax_status && !details.tax_id)) return 'Not on file'
  const parts: string[] = []
  switch (details.tax_status) {
    case '501c3_public_charity':
      parts.push(
        'Tax-exempt under Section 501(c)(3); public charity described in Sections 509(a)(1)–(3).'
      )
      break
    case '501c3_private_foundation':
      parts.push('Tax-exempt under Section 501(c)(3); private foundation.')
      break
    case 'other_nonprofit':
      parts.push('Nonprofit organization; not described in Section 501(c)(3).')
      break
    case 'government':
      parts.push('Government entity.')
      break
    case 'for_profit':
      parts.push('For-profit entity.')
      break
    case 'individual':
      parts.push('Individual.')
      break
    default:
      parts.push('Tax status not on file.')
  }
  if (details.tax_id) parts.push(`EIN ${details.tax_id}.`)
  return parts.join(' ')
}

export function granteeLines(grantee: Contact, descriptor: string | null): string[] {
  const legalName = grantee.legal_name?.trim() || grantee.display_name
  const nameLine = descriptor?.trim() ? `${legalName}, ${descriptor.trim()}` : legalName

  const addr = grantee
  const lines = [
    nameLine,
    addr.address_line1,
    addr.address_line2,
    cityStateZip(addr.city, addr.state, addr.postal_code),
    addr.country && addr.country !== 'US' ? addr.country : null,
  ].filter((l): l is string => Boolean(l && l.trim()))
  return lines
}

/**
 * "Name - email" for the principal contact: the person themselves when the
 * recipient is a person, else the organization's primary affiliated person
 * (falling back to the organization's own email).
 */
export function contactLines(grantee: Contact, principal: PrincipalContact | null): string[] {
  const person = grantee.kind === 'person' ? grantee : principal
  const personName = person?.display_name?.trim() ?? ''
  const email = person?.email ?? grantee.email
  const line = [personName || null, email].filter(Boolean).join(' - ')
  return line ? [line] : [EMPTY]
}

function keyDateLines(
  proposal: GrantProposal,
  award: GrantOut | null,
  disbursements: Disbursement[]
): string[] {
  const lines: string[] = []
  if (proposal.received_date) {
    lines.push(`Proposal received ${formatDateLong(proposal.received_date)}`)
  }
  if (proposal.decision && proposal.decision_date) {
    const verb = proposal.decision === 'approved' ? 'Approved' : 'Declined'
    lines.push(`${verb} ${formatDateLong(proposal.decision_date)}`)
  }
  if (award?.agreement_signed_date) {
    lines.push(`Grant agreement effective ${formatDateLong(award.agreement_signed_date)}`)
  }
  const paid = disbursements
    .filter((d) => d.status === 'paid' && d.paid_date)
    .sort((a, b) => (a.paid_date! < b.paid_date! ? -1 : 1))
  const label = (d: Disbursement) => (d.method === 'wire' ? ' (wire)' : d.method === 'ach' ? ' (ACH)' : d.method === 'check' ? ' (check)' : '')
  for (const d of paid) {
    lines.push(
      `Installment of ${formatCents(d.amount_cents)} paid${label(d)} ${formatDateLong(d.paid_date!)}`
    )
  }
  return lines.length > 0 ? lines : [EMPTY]
}

export function buildMemoData(
  proposal: GrantProposal,
  memo: ProposalMemo,
  grantee: Contact,
  principal: PrincipalContact | null,
  award: GrantOut | null,
  disbursements: Disbursement[],
  settings: OrgSettings,
  generatedDate: string
): MemoData {
  const orgLegalName = requireLegalName(settings)
  const amount = award
    ? formatCents(award.amount_awarded_cents)
    : `${formatCents(proposal.amount_requested_cents)} (requested)`

  const headerRows: MemoData['headerRows'] = [
    { label: 'Grantee', lines: granteeLines(grantee, memo.header_grantee_descriptor) },
    { label: 'Principal contact', lines: contactLines(grantee, principal) },
    { label: 'Tax status', lines: [formatTaxStatusLine(grantee)] },
    { label: 'Grant amount', lines: [amount] },
    { label: 'Purpose', lines: [memo.header_purpose?.trim() || award?.purpose?.trim() || EMPTY] },
    { label: 'Structure', lines: [memo.header_structure?.trim() || EMPTY] },
    { label: 'Key dates', lines: keyDateLines(proposal, award, disbursements) },
    { label: 'Decision', lines: [memo.header_decision?.trim() || EMPTY] },
  ]

  const sections: MemoData['sections'] = MEMO_SECTION_FIELDS.map(([key, heading], index) => ({
    number: index + 1,
    heading,
    body: (memo[key] ?? '').trim() || '(Not completed)',
  }))

  return {
    orgLegalName,
    subtitle: `${orgLegalName} - Grant Record`,
    generatedDate: formatDateLong(generatedDate),
    granteeName: grantee.legal_name?.trim() || grantee.display_name,
    headerRows,
    sections,
  }
}
