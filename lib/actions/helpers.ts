import { getAuthState } from '@/lib/auth'
import { ActionError } from './result'
import { getOrgSettings } from '@/lib/settings'
import { isVotingMember } from '@/lib/grants/voting'

export { ActionError, runAction, actionErrorMessage, type ActionResult } from './result'

/** Resolve the current user's team_members id, or throw. */
export async function requireMemberId(): Promise<string> {
  const { userId, memberId } = await getAuthState()
  if (!userId) throw new ActionError('Not authenticated')
  if (!memberId) throw new ActionError('Not an active team member')
  return memberId
}

/** Like requireMemberId, but only for admins. */
export async function requireAdminId(): Promise<string> {
  const memberId = await requireMemberId()
  const { isAdmin } = await getAuthState()
  if (!isAdmin) throw new ActionError('Only admins can do this')
  return memberId
}

/**
 * Like requireMemberId, but only for the grant-review voting body
 * (org_settings.grant_review_mode): everyone, or admins only. Mirrors
 * is_grant_voter() in the database, which is the real gate.
 */
export async function requireGrantVoterId(): Promise<string> {
  const memberId = await requireMemberId()
  const { memberRole } = await getAuthState()
  const { grant_review_mode: mode } = await getOrgSettings()
  if (!memberRole || !isVotingMember({ role: memberRole }, mode)) {
    throw new ActionError('Only admins review and decide grant proposals')
  }
  return memberId
}

export function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ActionError(`Missing required field: ${key}`)
  }
  return value.trim()
}

export function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
