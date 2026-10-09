import type { NextConfig } from 'next'

/** '' or '/segment' — no trailing slash (mirrors normalizeBasePath in lib/basePath.ts) */
function basePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

// Security headers - CSP is set dynamically in middleware with per-request nonce
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  // Optional sub-path (NEXT_PUBLIC_BASE_PATH, e.g. "/office") for serving the
  // app under another site's domain, e.g. as a Next.js multi-zone. Empty by
  // default: the app is served at the domain root. lib/basePath.ts reads the
  // same variable for plain <a>/fetch URLs; keep the normalization in sync.
  basePath: basePath(process.env.NEXT_PUBLIC_BASE_PATH),
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
