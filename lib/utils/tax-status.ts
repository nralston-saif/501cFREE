import type { ContactTaxStatus, PublicCharityStatus } from '@/lib/supabase/types/database'

export const TAX_STATUS_LABELS: Record<ContactTaxStatus, string> = {
  '501c3_public_charity': '501(c)(3) public charity',
  '501c3_private_foundation': '501(c)(3) private foundation',
  other_nonprofit: 'Other nonprofit',
  government: 'Government entity',
  for_profit: 'For-profit',
  individual: 'Individual',
}

export const TAX_STATUS_OPTIONS = Object.entries(TAX_STATUS_LABELS) as [
  ContactTaxStatus,
  string,
][]

/**
 * The organization's own IRS classification (org_settings.public_charity_status),
 * as it appears on its IRS determination letter or in Tax Exempt Organization
 * Search. Null = not specified: letters then state only 501(c)(3) status.
 */
export const PUBLIC_CHARITY_STATUS_LABELS: Record<PublicCharityStatus, string> = {
  '509a1': 'Public charity: 509(a)(1) / 170(b)(1)(A) (e.g. (vi), publicly supported)',
  '509a2': 'Public charity: 509(a)(2)',
  '509a3': 'Supporting organization: 509(a)(3)',
  private_foundation: 'Private foundation',
}

export const PUBLIC_CHARITY_STATUS_OPTIONS = Object.entries(PUBLIC_CHARITY_STATUS_LABELS) as [
  PublicCharityStatus,
  string,
][]

export function isPublicCharityStatus(value: unknown): value is PublicCharityStatus {
  return typeof value === 'string' && value in PUBLIC_CHARITY_STATUS_LABELS
}
