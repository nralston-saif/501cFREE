'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { withBasePath } from '@/lib/basePath'
import { safeNextPath } from '@/lib/site-url'
import AuthCard from '@/components/AuthCard'
import { useLocationHash, useLocationSearch } from '@/lib/hooks/useLocation'

/** The link's tokens (fragment) and post-sign-in destination (query). */
function parseLink(hashString: string, search: string) {
  const hash = new URLSearchParams(hashString.replace(/^#/, ''))
  const query = new URLSearchParams(search)
  const linkError = hash.get('error_description') ?? hash.get('error')
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  return {
    next: safeNextPath(query.get('next')),
    accessToken,
    refreshToken,
    type: hash.get('type'),
    problem: linkError
      ? linkError.replace(/\+/g, ' ')
      : !accessToken || !refreshToken
        ? 'This sign-in link is invalid or has already been used.'
        : null,
  }
}

// Finishes sign-in for email links whose tokens arrive in the URL fragment
// (Supabase's default templates for server-issued links such as team
// invites). /auth/callback redirects here because the server never sees the
// fragment. The browser client is PKCE-only and ignores fragment tokens, so
// set the session explicitly.
export default function ConfirmPage() {
  const hashString = useLocationHash()
  const search = useLocationSearch()
  // A bad link is known from the URL alone (once it's readable, after
  // hydration); a failed setSession arrives later
  const linkProblem =
    hashString !== null && search !== null ? parseLink(hashString, search).problem : null
  const [sessionError, setSessionError] = useState<string | null>(null)
  const error = linkProblem ?? sessionError

  useEffect(() => {
    if (hashString === null || search === null) return
    const { next, accessToken, refreshToken, type, problem } = parseLink(hashString, search)
    if (problem || !accessToken || !refreshToken) return

    ;(async () => {
      try {
        const supabase = createClient()
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (sessionError) throw sessionError
        const destination =
          type === 'invite' || type === 'recovery'
            ? `/auth/set-password?next=${encodeURIComponent(next)}`
            : next
        // Full navigation (not router.replace) so the server sees the new
        // session cookies and the fragment tokens leave the address bar
        window.location.replace(withBasePath(destination))
      } catch (err) {
        setSessionError(err instanceof Error ? err.message : 'Could not complete sign-in.')
      }
    })()
  }, [hashString, search])

  return (
    <AuthCard title={error ? 'Sign-in link problem' : 'Signing you in…'}>
      {error ? (
        <div className="space-y-4 text-center">
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100">
            {error}
          </div>
          <p className="text-sm text-gray-500">
            Links expire after a while and work only once. Ask an admin to resend your invite, or
            use &ldquo;Forgot password?&rdquo; on the sign-in page.
          </p>
          <Link href="/login" className="btn btn-primary w-full py-3">
            Go to sign in
          </Link>
        </div>
      ) : (
        <p className="text-center text-sm text-gray-500">One moment.</p>
      )}
    </AuthCard>
  )
}
