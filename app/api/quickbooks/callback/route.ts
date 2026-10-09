import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { BASE_PATH } from '@/lib/basePath'
import { exchangeAuthCode, qboRedirectUri, storeConnection } from '@/lib/quickbooks/client'
import { getCompanyName } from '@/lib/quickbooks/api'
import { getConnection } from '@/lib/quickbooks/client'

export const dynamic = 'force-dynamic'

/** Completes the QuickBooks OAuth flow: validates state, exchanges the code, stores tokens. */
export async function GET(request: NextRequest) {
  const settingsUrl = (params: string) =>
    NextResponse.redirect(new URL(`${BASE_PATH}/settings?${params}`, request.nextUrl.origin))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/login`, request.nextUrl.origin))
  }
  const { isAdmin } = await getAuthState()
  if (!isAdmin) {
    return settingsUrl('qbo=error&qbo_message=Only admins can connect QuickBooks')
  }

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const realmId = request.nextUrl.searchParams.get('realmId')
  const cookieState = request.cookies.get('qbo_oauth_state')?.value

  if (!code || !realmId) {
    return settingsUrl('qbo=error&qbo_message=QuickBooks did not return an authorization code')
  }
  if (!state || !cookieState || state !== cookieState) {
    return settingsUrl('qbo=error&qbo_message=OAuth state mismatch — try connecting again')
  }

  try {
    const tokens = await exchangeAuthCode(code, qboRedirectUri(request.nextUrl.origin))

    const { data: member } = await supabase
      .from('team_members')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    await storeConnection({
      tokens,
      realmId,
      companyName: null,
      connectedBy: member?.id ?? null,
    })

    // Fill in the company name for the settings display (best-effort).
    const conn = await getConnection()
    if (conn) {
      const companyName = await getCompanyName(conn)
      if (companyName) {
        const { createAdminClient } = await import('@/lib/supabase/admin')
        await createAdminClient()
          .from('qbo_connection')
          .update({ company_name: companyName })
          .eq('id', 1)
      }
    }

    const response = settingsUrl('qbo=connected')
    response.cookies.set('qbo_oauth_state', '', { maxAge: 0, path: BASE_PATH })
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed'
    return settingsUrl(`qbo=error&qbo_message=${encodeURIComponent(message.slice(0, 200))}`)
  }
}
