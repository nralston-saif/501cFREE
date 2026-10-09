import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { BASE_PATH } from '@/lib/basePath'
import { QBO_AUTH_URL, QBO_SCOPE, qboConfig, qboRedirectUri } from '@/lib/quickbooks/client'

export const dynamic = 'force-dynamic'

/**
 * Starts the QuickBooks OAuth flow: sets a state cookie and redirects the
 * admin's browser to Intuit's consent page. (Route handler rather than a
 * server action because OAuth is a browser redirect dance.)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Connecting replaces the organization's books connection: admins only
  const { isAdmin } = await getAuthState()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Only admins can connect QuickBooks' }, { status: 403 })
  }

  const cfg = qboConfig()
  if (!cfg) {
    return NextResponse.json(
      { error: 'QuickBooks keys not configured (QBO_CLIENT_ID / QBO_CLIENT_SECRET)' },
      { status: 500 }
    )
  }

  const state = crypto.randomUUID()
  const authUrl = new URL(QBO_AUTH_URL)
  authUrl.searchParams.set('client_id', cfg.clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', QBO_SCOPE)
  authUrl.searchParams.set('redirect_uri', qboRedirectUri(request.nextUrl.origin))
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 600,
    path: BASE_PATH,
  })
  return response
}
