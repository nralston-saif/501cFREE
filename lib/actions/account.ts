'use server'

import { createClient as createBareClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { getAuthState } from '@/lib/auth'
import { requiredString, ActionError, actionErrorMessage } from './helpers'

export type AccountActionState = { error: string | null; ok: boolean }

/**
 * Self-serve password change: verify the current password (a throwaway
 * sign-in against the auth API — updateUser alone would let a hijacked
 * session set a new password without knowing the old one), then set the new
 * one via the admin API and log a password_change audit event.
 */
export async function changePasswordAction(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  try {
    if (isDemoMode()) {
      throw new ActionError('Password changes are not available in demo mode')
    }

    const { userId, memberId } = await getAuthState()
    if (!userId || !memberId) {
      throw new ActionError('Not signed in')
    }

    const current = requiredString(formData, 'current_password')
    const next = requiredString(formData, 'new_password')
    const confirm = requiredString(formData, 'confirm_password')

    if (next !== confirm) {
      throw new ActionError('The new passwords do not match')
    }
    if (next.length < 7) {
      throw new ActionError('New password must be at least 7 characters')
    }
    if (next === current) {
      throw new ActionError('New password must be different from the current one')
    }

    const supabase = await createClient()
    const { data: member } = await supabase
      .from('team_members')
      .select('email, role')
      .eq('id', memberId)
      .single()
    if (!member?.email) {
      throw new ActionError('Could not resolve your account')
    }

    // Verify the current password without touching the browser session
    const bare = createBareClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { error: verifyError } = await bare.auth.signInWithPassword({
      email: member.email,
      password: current,
    })
    if (verifyError) {
      throw new ActionError('Current password is incorrect')
    }

    const admin = createAdminClient()
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password: next,
    })
    if (updateError) {
      throw new ActionError(`Could not update the password: ${updateError.message}`)
    }

    // The session triggers only see logins/logouts; record the change itself
    await admin.from('audit_log').insert({
      actor_member_id: memberId,
      actor_email: member.email,
      actor_role: (member as { role?: string }).role ?? null,
      event_type: 'password_change',
      entity_type: 'account',
    })

    return { error: null, ok: true }
  } catch (err) {
    return {
      error: actionErrorMessage(err, 'Password change failed unexpectedly'),
      ok: false,
    }
  }
}

/** Sign-in methods that prove the user just opened an email link we sent. */
const EMAIL_LINK_METHODS = new Set(['invite', 'recovery', 'magiclink', 'otp', 'email/signup'])
/** How long after opening the link the user may set a password without the old one. */
const EMAIL_LINK_WINDOW_SECONDS = 60 * 60

/**
 * Set a password without knowing the current one — only right after the user
 * signed in from an invite or password-reset email (checked against the
 * session's authentication-method claims), so a hijacked long-lived session
 * can't use it to take over the account. Everyone else goes through
 * changePasswordAction.
 */
export async function setPasswordAction(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  try {
    if (isDemoMode()) {
      throw new ActionError('Password changes are not available in demo mode')
    }

    const { userId, memberId } = await getAuthState()
    if (!userId || !memberId) {
      throw new ActionError('Not signed in')
    }

    const next = requiredString(formData, 'new_password')
    const confirm = requiredString(formData, 'confirm_password')
    if (next !== confirm) {
      throw new ActionError('The passwords do not match')
    }
    if (next.length < 7) {
      throw new ActionError('Password must be at least 7 characters')
    }

    const supabase = await createClient()
    const { data: claimsData } = await supabase.auth.getClaims()
    const amr = (claimsData?.claims?.amr ?? []) as ({ method: string; timestamp: number } | string)[]
    const now = Math.floor(Date.now() / 1000)
    const fromEmailLink = amr.some(
      (entry) =>
        typeof entry === 'object' &&
        EMAIL_LINK_METHODS.has(entry.method) &&
        now - entry.timestamp <= EMAIL_LINK_WINDOW_SECONDS
    )
    if (!fromEmailLink) {
      throw new ActionError(
        'This link has expired. Use "Forgot password?" on the sign-in page to get a new one, or change your password from your Account page.'
      )
    }

    const { data: member } = await supabase
      .from('team_members')
      .select('email, role')
      .eq('id', memberId)
      .single()

    const admin = createAdminClient()
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password: next,
    })
    if (updateError) {
      throw new ActionError(`Could not set the password: ${updateError.message}`)
    }

    await admin.from('audit_log').insert({
      actor_member_id: memberId,
      actor_email: member?.email ?? null,
      actor_role: (member as { role?: string } | null)?.role ?? null,
      event_type: 'password_set',
      entity_type: 'account',
    })

    return { error: null, ok: true }
  } catch (err) {
    return {
      error: actionErrorMessage(err, 'Setting the password failed unexpectedly'),
      ok: false,
    }
  }
}
