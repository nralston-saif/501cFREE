import type { OrgSettings } from '@/lib/supabase/types/database'

/**
 * PRI policy: board approval is required before funding only for
 * investments at or above the threshold set in org settings. A null
 * threshold means the organization has no such requirement.
 */
export function requiresBoardApproval(
  amountCents: number,
  thresholdCents: OrgSettings['pri_board_approval_threshold_cents']
): boolean {
  return thresholdCents != null && amountCents >= thresholdCents
}
