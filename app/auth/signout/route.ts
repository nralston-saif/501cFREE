import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { BASE_PATH } from '@/lib/basePath'

// Ends the session and returns to the login page. scope 'local' ends this
// browser's session only, not the user's other devices.

async function signOut(request: NextRequest) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: `${BASE_PATH}/login`, 'Cache-Control': 'no-store' },
  })

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (toSet) =>
            toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
        },
      }
    )
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }

  // Belt and braces: expire any auth cookie still present (e.g. a session the
  // auth server had already revoked, where signOut skips the cookie cleanup).
  for (const c of request.cookies.getAll()) {
    if (/^sb-[a-z0-9-]+-auth-token/.test(c.name) && !response.cookies.get(c.name)) {
      response.cookies.set(c.name, '', { path: '/', maxAge: 0 })
    }
  }
  return response
}

export const GET = signOut
export const POST = signOut
