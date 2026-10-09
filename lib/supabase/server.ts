import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from './types/database'
import { createDemoClient, isDemoMode } from './demo/mock-client'

export async function createClient(): Promise<SupabaseClient<Database>> {
  // Demo mode: no Supabase project configured - serve in-memory sample data
  if (isDemoMode()) {
    return createDemoClient() as unknown as SupabaseClient<Database>
  }

  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Same client with the cookies read up front, so it keeps working inside
 * after() callbacks (where next/headers is no longer available). It can't
 * refresh the session, so use it only for work that starts right away.
 */
export async function createClientSnapshot(): Promise<SupabaseClient<Database>> {
  if (isDemoMode()) {
    return createDemoClient() as unknown as SupabaseClient<Database>
  }
  const snapshot = (await cookies()).getAll()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => snapshot, setAll: () => {} } }
  )
}
