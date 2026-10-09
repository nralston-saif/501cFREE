'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import type { TeamMemberRole } from '@/lib/supabase/types/database'
import { authCallbackUrl, requestOrigin } from '@/lib/site-url'
import { requireAdminId, requiredString, ActionError, actionErrorMessage } from './helpers'

// Team management (Settings > Team), admins only. team_members is the sign-in
// allowlist: the link_team_member trigger (0001_core.sql) attaches a new auth
// user to the row with the same email and rejects everyone else, so the row
// must exist before the auth user does.

export type TeamActionState = {
  error: string | null
  ok: boolean
  /** Success message to show inline */
  message?: string
  /** Submitted values echoed back so the form survives React's post-action reset */
  values?: { full_name: string; email: string; role: TeamMemberRole }
}

/** Banned "forever" (~100 years); 'none' lifts the ban. */
const BAN_FOREVER = '876000h'

function parseRole(raw: FormDataEntryValue | null): TeamMemberRole {
  if (raw === 'admin' || raw === 'staff') return raw
  throw new ActionError('Invalid role')
}

function toState(err: unknown, fallback: string): TeamActionState {
  return { error: actionErrorMessage(err, fallback), ok: false }
}

/**
 * Refuse a change that would leave no active admin (nobody could manage the
 * team or settings any more). `memberId` is the admin losing admin access.
 */
async function assertAnotherActiveAdmin(memberId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .neq('id', memberId)
    .limit(1)
  if (error) throw new ActionError(error.message)
  if (!data || data.length === 0) {
    throw new ActionError('Every team needs at least one active admin — make someone else an admin first')
  }
}

async function loadMember(memberId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('id, email, role, is_active, auth_user_id')
    .eq('id', memberId)
    .maybeSingle()
  if (error) throw new ActionError(error.message)
  if (!data) throw new ActionError('Team member not found')
  return data
}

/**
 * useActionState wrapper for addTeamMember: a thrown ActionError in a plain
 * <form action> surfaces as the app's generic error page in production, which
 * is useless feedback — this returns the message to render inline instead.
 */
export async function addTeamMemberAction(
  _prev: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const values = {
    full_name: String(formData.get('full_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    role: formData.get('role') === 'admin' ? ('admin' as const) : ('staff' as const),
  }
  try {
    const message = await addTeamMember(formData)
    return { error: null, ok: true, message }
  } catch (err) {
    return { ...toState(err, 'Adding the team member failed unexpectedly — check the server logs'), values }
  }
}

/**
 * Add a team member: the allowlist row first, then a Supabase invite email
 * whose link signs them in and asks them to choose a password (see
 * app/auth/callback). If the email already has a login (e.g. someone removed
 * and re-added), link that user instead of inviting. Returns a message for
 * the admin.
 */
async function addTeamMember(formData: FormData): Promise<string> {
  await requireAdminId()

  if (isDemoMode()) {
    throw new ActionError('Adding team members is not available in demo mode')
  }

  const fullName = requiredString(formData, 'full_name')
  const email = requiredString(formData, 'email').toLowerCase()
  const role = parseRole(formData.get('role') ?? 'staff')

  const admin = createAdminClient()

  const { data: teamRow, error: insertError } = await admin
    .from('team_members')
    .insert({ email, full_name: fullName, role, is_active: true })
    .select('id')
    .single()

  if (insertError) {
    throw new ActionError(
      insertError.code === '23505'
        ? `${email} is already a team member — use Activate to restore access`
        : insertError.message
    )
  }

  const redirectTo = authCallbackUrl(requestOrigin(await headers()))
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: fullName },
  })

  if (inviteError) {
    if (/already (been )?registered|already exists/i.test(inviteError.message)) {
      // An auth user with this email exists, so the creation trigger won't
      // fire again: resolve its id and link it by hand.
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      })
      const authUserId = link?.user?.id
      if (!linkError && authUserId) {
        const { error: updateError } = await admin
          .from('team_members')
          .update({ auth_user_id: authUserId })
          .eq('id', teamRow.id)
        if (!updateError) {
          // Lift any ban left over from an earlier deactivation
          await admin.auth.admin.updateUserById(authUserId, { ban_duration: 'none' })
          revalidatePath('/settings')
          return `${email} already had a login, so no invite was sent. They can sign in with their existing password or use "Forgot password?" on the sign-in page.`
        }
      }
    }

    // Roll back the allowlist row so a retry isn't blocked by the unique email
    await admin.from('team_members').delete().eq('id', teamRow.id)
    throw new ActionError(`Could not send the invite: ${inviteError.message}`)
  }

  revalidatePath('/settings')
  return `Invite sent to ${email}. The link signs them in and asks them to choose a password.`
}

/** useActionState wrapper for setTeamMemberActive. */
export async function setTeamMemberActiveAction(
  _prev: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  try {
    await setTeamMemberActive(formData)
    return { error: null, ok: true }
  } catch (err) {
    return toState(err, 'Updating the team member failed unexpectedly')
  }
}

/**
 * Activate or deactivate a team member. Deactivation revokes access through
 * RLS immediately (every policy checks is_active) and bans the auth user so
 * their sessions can't be refreshed; activation lifts the ban.
 */
async function setTeamMemberActive(formData: FormData) {
  const currentMemberId = await requireAdminId()

  const memberId = requiredString(formData, 'member_id')
  const active = requiredString(formData, 'active') === 'true'

  if (!active && memberId === currentMemberId) {
    throw new ActionError('You cannot deactivate your own account')
  }

  const member = await loadMember(memberId)
  if (!active && member.role === 'admin' && member.is_active) {
    await assertAnotherActiveAdmin(memberId)
  }

  const admin = isDemoMode() ? null : createAdminClient()

  // Reactivating: lift the ban first, so a failure leaves them inactive
  // rather than "active" but unable to sign in
  if (active && admin && member.auth_user_id) {
    const { error } = await admin.auth.admin.updateUserById(member.auth_user_id, {
      ban_duration: 'none',
    })
    if (error) throw new ActionError(`Could not restore their login: ${error.message}`)
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('team_members')
    .update({ is_active: active })
    .eq('id', memberId)
  if (error) throw new ActionError(error.message)

  revalidatePath('/settings')

  if (!active && admin && member.auth_user_id) {
    const { error: banError } = await admin.auth.admin.updateUserById(member.auth_user_id, {
      ban_duration: BAN_FOREVER,
    })
    if (banError) {
      // Access is already revoked by RLS; the ban only stops session refresh
      throw new ActionError(
        `Deactivated, but their open sessions could not be ended: ${banError.message}`
      )
    }
  }
}

/** useActionState wrapper for setTeamMemberRole. */
export async function setTeamMemberRoleAction(
  _prev: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  try {
    await setTeamMemberRole(formData)
    return { error: null, ok: true }
  } catch (err) {
    return toState(err, 'Changing the role failed unexpectedly')
  }
}

/** Change a member's role between admin and staff. Never strands the team without an admin. */
async function setTeamMemberRole(formData: FormData) {
  await requireAdminId()

  const memberId = requiredString(formData, 'member_id')
  const role = parseRole(formData.get('role'))

  const member = await loadMember(memberId)
  if (member.role === role) return
  if (member.role === 'admin' && member.is_active) {
    await assertAnotherActiveAdmin(memberId)
  }

  const supabase = await createClient()
  const { error } = await supabase.from('team_members').update({ role }).eq('id', memberId)
  if (error) throw new ActionError(error.message)

  revalidatePath('/settings')
}
