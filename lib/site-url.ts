import { BASE_PATH } from './basePath'

// Absolute URLs for links that leave the app and come back: auth emails
// (invites, password resets) carry a redirect to /auth/callback, so they need
// the public origin, not whatever host served the request. Set
// NEXT_PUBLIC_SITE_URL (scheme + host, no path, e.g. https://office.example.org)
// in production; without it we fall back to the request's own origin.
// Safe to import from client and server code.

/** The public origin: NEXT_PUBLIC_SITE_URL, else the given fallback. */
export function siteOrigin(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return configured || fallbackOrigin.replace(/\/+$/, '')
}

/**
 * Origin of an incoming request, honoring a reverse proxy's forwarded host
 * and protocol (the original client-facing values) when present.
 */
export function requestOrigin(headers: { get(name: string): string | null }, fallbackUrl?: URL): string {
  const first = (name: string) => headers.get(name)?.split(',')[0]?.trim() || null
  const host = first('x-forwarded-host') ?? first('host') ?? fallbackUrl?.host ?? 'localhost:3000'
  const proto =
    first('x-forwarded-proto') ??
    fallbackUrl?.protocol.replace(':', '') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}

/**
 * The absolute auth-callback URL for email links. `next` is where the user
 * lands once signed in (an app path, without the basePath).
 */
export function authCallbackUrl(fallbackOrigin: string, next?: string): string {
  const url = `${siteOrigin(fallbackOrigin)}${BASE_PATH}/auth/callback`
  return next ? `${url}?next=${encodeURIComponent(next)}` : url
}

/**
 * Sanitize a user-supplied "next" path for post-login redirects: only
 * same-origin app paths survive. Parsing with URL (rather than prefix checks)
 * catches protocol-relative and whitespace tricks such as "/\t/evil.com",
 * which browsers normalize to "//evil.com". Returns an app path without the
 * basePath; '/' when invalid.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || /[\u0000-\u001f\u007f\s\\]/.test(raw)) return '/'
  let parsed: URL
  try {
    parsed = new URL(raw, 'http://app.invalid')
  } catch {
    return '/'
  }
  if (parsed.origin !== 'http://app.invalid') return '/'
  let path = `${parsed.pathname}${parsed.search}${parsed.hash}`
  if (BASE_PATH && (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`))) {
    path = path.slice(BASE_PATH.length)
    if (!path.startsWith('/')) path = `/${path}`
  }
  return path.startsWith('//') ? '/' : path
}
