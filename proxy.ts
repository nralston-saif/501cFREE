import { updateSession, NextResponse, type NextRequest } from '@/lib/supabase/middleware'

// Generate a cryptographically secure nonce
function generateNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Buffer.from(array).toString('base64')
}

// Build Content Security Policy header with nonce
function buildCSP(nonce: string): string {
  // The app talks to exactly one Supabase project (REST/auth/storage over
  // https, realtime over wss) and, when live meeting notes are enabled,
  // Liveblocks.
  let supabaseOrigin = ''
  let supabaseWs = ''
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    supabaseOrigin = url.origin
    supabaseWs = `${url.protocol === 'http:' ? 'ws' : 'wss'}://${url.host}`
  } catch {
    // Not configured (demo mode): nothing extra to allow
  }
  const directives = [
    "default-src 'self'",
    // React's dev build uses eval() for debugging; production never does
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
    "font-src 'self'",
    // Local previews of PDFs the user is about to upload (blob: URLs)
    "object-src 'self' blob:",
    "frame-src 'self' blob:",
    ['connect-src', "'self'", supabaseOrigin, supabaseWs, 'https://api.liveblocks.io', 'wss://api.liveblocks.io']
      .filter(Boolean)
      .join(' '),
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
  return directives.join('; ')
}

// Endpoints that authenticate with a shared secret (public intake, cron)
// or serve demo-mode sample files
const PUBLIC_API_PREFIXES = ['/api/public/', '/api/cron/', '/api/demo-files']

function isLiveMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_SUPABASE === 'true' && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
}

export async function proxy(request: NextRequest) {
  // Next.js reads the nonce from the request's CSP header and stamps it on
  // its own scripts, so the policy goes on the request as well as the
  // response. Pages render per request (the root layout reads headers()),
  // which nonces require.
  const csp = buildCSP(generateNonce())
  const forwardHeaders = { 'content-security-policy': csp }
  const withCsp = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', csp)
    return response
  }
  const next = () => {
    const headers = new Headers(request.headers)
    headers.set('content-security-policy', csp)
    return withCsp(NextResponse.next({ request: { headers } }))
  }

  // API routes do their own authorization. As a first line of defense,
  // requests without any session cookie are turned away here, except the
  // endpoints that authenticate another way (shared secrets) or don't need to.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (
      isLiveMode() &&
      !PUBLIC_API_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p)) &&
      !request.cookies.getAll().some((c) => /^sb-.+-auth-token/.test(c.name))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return next()
  }

  // Demo mode (default until NEXT_PUBLIC_USE_SUPABASE=true): open access, no auth
  if (!isLiveMode()) {
    if (request.nextUrl.pathname === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
    return next()
  }

  return withCsp(
    await updateSession(request, {
      publicPaths: ['/login', '/auth', '/_next', '/access-denied'],
      loginPath: '/login',
      defaultRedirect: '/',
      forwardHeaders,
    })
  )
}

export const config = {
  matcher: [
    // The root needs its own entry: under a basePath the pattern below
    // doesn't match the bare basePath URL, which would skip this proxy.
    '/',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
