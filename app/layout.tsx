import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Montserrat } from 'next/font/google'
import './globals.css'
import Providers from '@/components/Providers'
import { APP_NAME } from '@/lib/branding'

// Self-hosted at build time by next/font; exposed as a CSS variable that
// globals.css puts at the head of the body font stack.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-montserrat',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME}: contributions, grants, expenses and contacts for a nonprofit team`,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Reading request headers renders every page per request, which the
  // nonce-based Content Security Policy set in proxy.ts requires
  await headers()
  return (
    <html lang="en" className={montserrat.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
