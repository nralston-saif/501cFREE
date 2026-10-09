import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { TeamMemberRole } from '@/lib/supabase/types/database'

export type AuthState = {
  userId: string | null
  /** Active team_members id, null when not an active member */
  memberId: string | null
  /** admin or staff; admins also manage expenses, QuickBooks, the team and
   * settings, and are the grant-review voting body */
  memberRole: TeamMemberRole | null
  isAdmin: boolean
  /** Display name for the header's profile menu */
  memberName: string | null
}

/**
 * Per-request cached auth + membership lookup shared by the layout, pages,
 * and server actions — each request pays for it exactly once instead of the
 * layout, page, and action all repeating it. Session validation is local
 * (JWT signature + expiry via getClaims against the project's cached JWKS);
 * middleware handles token refresh, so no auth-server round trip here.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createClient()

  let userId: string | null = null
  if (typeof supabase.auth.getClaims === 'function') {
    const { data } = await supabase.auth.getClaims()
    userId = data?.claims?.sub ?? null
  } else {
    // The demo mock client only implements getUser
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return { userId: null, memberId: null, memberRole: null, memberName: null, isAdmin: false }

  const { data: member } = await supabase
    .from('team_members')
    .select('id, role, full_name')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  const memberRole = (member as { role?: TeamMemberRole } | null)?.role ?? null
  return {
    userId,
    memberId: member?.id ?? null,
    memberRole,
    memberName: (member as { full_name?: string } | null)?.full_name ?? null,
    isAdmin: memberRole === 'admin',
  }
})
