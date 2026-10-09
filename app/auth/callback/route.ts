import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { BASE_PATH } from '@/lib/basePath'
import { safeNextPath } from '@/lib/site-url'

// Landing point for every auth email link: invites, password resets, and
// magic links. Three shapes arrive here:
//   ?code=…                    PKCE (links requested from this browser, e.g.
//                              "Forgot password")
//   ?token_hash=…&type=…       email templates that link straight here
//                              ({{ .TokenHash }}), the most robust setup
//   #access_token=…            Supabase's default templates for links the
//                              server issued (admin invites): tokens ride in
//                              the URL fragment, which never reaches the
//                              server, so we hand off to /auth/confirm (the
//                              browser carries the fragment across the redirect)
//
// Invites and recoveries land on /auth/set-password so the user picks a
// password; everything else goes to `next` (default: the dashboard).
//
// Redirects are relative so the browser resolves them against whatever
// public host it used, including when proxied under a basePath.

function withBase(path: string): string {
  return path === '/' && BASE_PATH ? BASE_PATH : `${BASE_PATH}${path}`
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNextPath(searchParams.get('next'))

  const redirect = (path: string) =>
    new NextResponse(null, {
      status: 307,
      headers: { Location: withBase(path), 'Cache-Control': 'no-store' },
    })

  const setPassword = `/auth/set-password?next=${encodeURIComponent(next)}`
  const destination = (otpType: string | null) =>
    otpType === 'invite' || otpType === 'recovery' ? setPassword : next

  // Supabase reports expired/used links as query params on the redirect
  const linkError = searchParams.get('error_description') ?? searchParams.get('error')
  if (linkError) {
    return redirect(`/login?error=${encodeURIComponent(linkError)}`)
  }

  if (code || tokenHash) {
    const supabase = await createClient()

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) return redirect(destination(type))
      console.error('Auth callback code exchange error:', error)
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      if (!error) return redirect(destination(type))
      console.error('Auth callback OTP verification error:', error)
    }

    return redirect('/login?error=auth_failed')
  }

  // Nothing in the query: the session (if any) is in the URL fragment
  return redirect(`/auth/confirm?next=${encodeURIComponent(next)}`)
}
