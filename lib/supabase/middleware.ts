import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './types/database'

export interface MiddlewareConfig {
  /** Paths that don't require authentication */
  publicPaths?: string[]
  /** Path to redirect unauthenticated users to */
  loginPath?: string
  /** Path to redirect authenticated users to when accessing login page */
  defaultRedirect?: string
  /** Extra request headers to pass on to the app (e.g. the CSP with nonce) */
  forwardHeaders?: Record<string, string>
}

export async function updateSession(
  request: NextRequest,
  config: MiddlewareConfig = {}
) {
  const {
    publicPaths = ['/auth', '/_next', '/api'],
    loginPath = '/login',
    defaultRedirect = '/',
    forwardHeaders = {},
  } = config

  // Rebuilt after a token refresh so the app sees the new cookies too
  const passThrough = () => {
    const headers = new Headers(request.headers)
    for (const [name, value] of Object.entries(forwardHeaders)) headers.set(name, value)
    return NextResponse.next({ request: { headers } })
  }

  let supabaseResponse = passThrough()

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = passThrough()
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Validate the session locally: getClaims verifies the JWT's signature and
  // expiry against the project's JWKS (cached module-wide in supabase-js), so
  // there is no per-request auth-server round trip like getUser() made. The
  // network is only hit when the access token has expired and needs a refresh.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims ?? null

  const isPublicPath = publicPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  // Next 16 runs `new URL()` over the Location header when the middleware
  // response is handled — even when the header is set after construction — so
  // a relative Location throws ERR_INVALID_URL and turns every logged-out
  // redirect into a 500. The Location must be absolute. To keep the browser
  // on the public host when the app sits behind a reverse proxy (or is
  // mounted under a basePath on another site), build it from
  // x-forwarded-host (the original client host), falling back to the
  // request's own host for local dev and direct visits.
  const redirectTo = (pathname: string) => {
    const forwardedHost = request.headers
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim()
    const host = forwardedHost || request.nextUrl.host
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
      request.nextUrl.protocol.replace(':', '')
    const response = NextResponse.redirect(
      `${proto}://${host}${request.nextUrl.basePath}${pathname}`,
      307
    )
    // Never let a navigation serve a cached auth redirect (e.g. a stale
    // / -> /login from before the user had a session).
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  if (!user && !isPublicPath) {
    // Remember where they were headed so login can send them back
    const { pathname, search } = request.nextUrl
    const next = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`
    return redirectTo(`${loginPath}${next}`)
  }

  if (user && request.nextUrl.pathname === loginPath) {
    return redirectTo(defaultRedirect)
  }

  return supabaseResponse
}

export { NextResponse, type NextRequest }
