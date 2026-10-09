/**
 * Optional path prefix when the app is served under a sub-path of another
 * site (e.g. https://example.org/office). Set NEXT_PUBLIC_BASE_PATH (leading
 * slash, no trailing slash) at build time; next.config.ts reads the same
 * value. Default '' serves the app at the domain root.
 *
 * next/link and the Next router prepend the basePath automatically, but plain
 * <a href> and fetch() calls to route handlers (/api/*) do NOT, so prefix
 * those links/fetches with withBasePath().
 */
export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH)

export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** Prefix an app-absolute path with the basePath (for <a>/fetch to /api/*). */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`
}
