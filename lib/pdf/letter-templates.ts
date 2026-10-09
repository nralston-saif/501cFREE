import type { ContributionVehicle } from '@/lib/supabase/types/database'

/**
 * Editable acknowledgement-letter paragraphs (Settings → Acknowledgement
 * letters, stored in org_settings.letter_templates). Each vehicle group has
 * an opening paragraph and a tax paragraph; a group or field that isn't
 * stored uses the default below. Pure module, unit-tested in
 * letter-templates.test.ts.
 *
 * What stays fixed in letter-data.ts, because IRS Pub 1771 requires it: the
 * 501(c)(3) status sentence (plus the optional classification), the
 * statement that no goods or services were provided (or the quid pro quo
 * disclosure with a good-faith estimate), and the in-kind "no value" note.
 *
 * The defaults are a starting point written from IRS Pub 1771, Pub 526 and
 * Pub 590-B, not legal advice: have your own accountant or counsel review
 * them.
 */

export type LetterTemplateGroup = 'direct' | 'daf' | 'ira_qcd' | 'organization'

export type LetterTemplate = { opening: string; tax: string }

/** Stored overrides: absent group or field = default */
export type LetterTemplateOverrides = Partial<Record<LetterTemplateGroup, Partial<LetterTemplate>>>

export const LETTER_TEMPLATE_GROUPS: LetterTemplateGroup[] = ['direct', 'daf', 'ira_qcd', 'organization']

export const LETTER_TEMPLATE_GROUP_LABELS: Record<LetterTemplateGroup, string> = {
  direct: 'Direct gifts',
  daf: 'Donor-advised fund grants',
  ira_qcd: 'IRA qualified charitable distributions',
  organization: 'Employer matches, foundations, trusts and other vehicles',
}

export const LETTER_PLACEHOLDERS = {
  orgLegalName: "Your organization's legal name",
  orgShortName: "Your organization's short name",
  donor: "The donor's name (the contact the letter is for)",
  sponsor: 'The paying organization: DAF sponsor, employer, foundation or trust',
  gift: 'The amount, or a description of non-cash property',
  date: 'The date the gift was received',
} as const

export type LetterPlaceholder = keyof typeof LETTER_PLACEHOLDERS

export function letterTemplateGroup(vehicle: ContributionVehicle): LetterTemplateGroup {
  if (vehicle === 'direct') return 'direct'
  if (vehicle === 'daf') return 'daf'
  if (vehicle === 'ira_qcd') return 'ira_qcd'
  return 'organization'
}

/**
 * {sponsor} when the contribution has no vehicle_sponsor_name: the DAF and
 * QCD wording reads naturally with "your donor-advised fund" / "your IRA";
 * for the other vehicles the donor on record is the paying organization.
 */
export function sponsorFallback(group: LetterTemplateGroup, donorName: string): string {
  if (group === 'daf') return 'your donor-advised fund'
  if (group === 'ira_qcd') return 'your IRA'
  return donorName
}

export const DEFAULT_LETTER_TEMPLATES: Record<LetterTemplateGroup, LetterTemplate> = {
  // Pub 1771: name the organization, the cash amount or a description of
  // the property, and the date. Pub 526: gifts to a 501(c)(3) are
  // deductible within the limits the law sets.
  direct: {
    opening:
      'Thank you for your gift to {orgShortName}. This letter confirms that {orgLegalName} ' +
      'received {gift} from {donor} on {date}.',
    tax: 'Gifts to {orgShortName} are deductible as charitable contributions to the extent federal tax law allows.',
  },
  // Pub 526 (donor-advised funds); IRC §4966(d)(2) and §170(f)(18): the
  // sponsoring organization owns the fund and makes the grant; the donor's
  // deduction was for funding the account, so this grant isn't deducted again.
  daf: {
    opening:
      'We are grateful for the grant of {gift} from {sponsor}, recommended by {donor}. ' +
      'This letter confirms that {orgLegalName} received it on {date}.',
    tax:
      "A grant from a donor-advised fund is made by the fund's sponsoring organization, so it " +
      'is not separately deductible by the person who recommended it. Please ask your tax ' +
      'advisor how this applies to you.',
  },
  // Pub 590-B (qualified charitable distributions) and IRC §408(d)(8): a QCD
  // is left out of taxable income instead of being deducted.
  ira_qcd: {
    opening:
      'Thank you for your gift to {orgShortName}. This letter confirms that {orgLegalName} ' +
      'received {gift} on {date} as a qualified charitable distribution from {sponsor}.',
    tax:
      'A qualified charitable distribution is generally excluded from taxable income rather ' +
      'than deducted as a charitable contribution. Please ask your tax advisor how this ' +
      'applies to you.',
  },
  // The paying organization is the donor (Pub 526: you deduct only your own
  // contributions), so the letter makes no deductibility claim.
  organization: {
    opening:
      'We are grateful to {sponsor} for its gift of {gift} to {orgShortName}. This letter ' +
      'confirms that {orgLegalName} received it on {date}.',
    tax: '',
  },
}

const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g

/** Placeholders in a template that aren't in LETTER_PLACEHOLDERS */
export function unknownPlaceholders(template: string): string[] {
  const unknown = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    if (!(match[1] in LETTER_PLACEHOLDERS)) unknown.add(`{${match[1]}}`)
  }
  return [...unknown]
}

/** Fill {placeholders}; anything unknown is left as typed (saving rejects it). */
export function renderLetterTemplate(
  template: string,
  values: Record<LetterPlaceholder, string>
): string {
  return template
    .replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
      name in values ? values[name as LetterPlaceholder] : whole
    )
    .trim()
}

/** The opening and tax templates in force for a group: the override, else the default. */
export function resolveLetterTemplate(
  group: LetterTemplateGroup,
  overrides: unknown
): LetterTemplate {
  const stored = parseLetterTemplateOverrides(overrides)[group]
  const defaults = DEFAULT_LETTER_TEMPLATES[group]
  return {
    opening: stored?.opening ?? defaults.opening,
    tax: stored?.tax ?? defaults.tax,
  }
}

/** Read the jsonb column defensively: only known groups and string fields. */
export function parseLetterTemplateOverrides(value: unknown): LetterTemplateOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: LetterTemplateOverrides = {}
  for (const group of LETTER_TEMPLATE_GROUPS) {
    const entry = (value as Record<string, unknown>)[group]
    if (!entry || typeof entry !== 'object') continue
    const fields: Partial<LetterTemplate> = {}
    for (const field of ['opening', 'tax'] as const) {
      const text = (entry as Record<string, unknown>)[field]
      if (typeof text === 'string') fields[field] = text
    }
    if (Object.keys(fields).length > 0) result[group] = fields
  }
  return result
}

/**
 * Validate the Settings form and keep only what differs from the defaults,
 * so a later change to a default reaches every field nobody customized.
 * Returns an error naming the first unknown placeholder, or an empty opening.
 */
export function buildLetterTemplateOverrides(
  input: Record<LetterTemplateGroup, LetterTemplate>
): { ok: true; overrides: LetterTemplateOverrides } | { ok: false; error: string } {
  const overrides: LetterTemplateOverrides = {}
  for (const group of LETTER_TEMPLATE_GROUPS) {
    const label = LETTER_TEMPLATE_GROUP_LABELS[group]
    const fields: Partial<LetterTemplate> = {}
    for (const field of ['opening', 'tax'] as const) {
      const text = (input[group]?.[field] ?? '').replace(/\r\n/g, '\n').trim()
      const unknown = unknownPlaceholders(text)
      if (unknown.length > 0) {
        return {
          ok: false,
          error: `${label}, ${field === 'opening' ? 'opening' : 'tax'} paragraph: unknown placeholder ${unknown.join(', ')}. Use ${Object.keys(LETTER_PLACEHOLDERS).map((p) => `{${p}}`).join(', ')}.`,
        }
      }
      if (field === 'opening' && !text) {
        return { ok: false, error: `${label}: the opening paragraph can't be empty.` }
      }
      if (text !== DEFAULT_LETTER_TEMPLATES[group][field]) fields[field] = text
    }
    if (Object.keys(fields).length > 0) overrides[group] = fields
  }
  return { ok: true, overrides }
}
