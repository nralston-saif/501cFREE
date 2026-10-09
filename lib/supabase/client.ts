import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types/database'

// Browser-side stub for demo mode (no Supabase project configured).
// Only the auth methods the UI calls are needed; data access happens
// server-side where the full demo client lives.
const demoBrowserStub = {
  auth: {
    async signOut() {
      return { error: null }
    },
    async signInWithOtp() {
      return { data: {}, error: { message: 'Demo mode: authentication is disabled' } }
    },
    async signInWithPassword() {
      return { data: {}, error: { message: 'Demo mode: authentication is disabled' } }
    },
  },
}

export function createClient() {
  // Demo unless explicitly opted into live mode (see isDemoMode in demo/mock-client.ts)
  if (
    process.env.NEXT_PUBLIC_USE_SUPABASE !== 'true' ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  ) {
    return demoBrowserStub as unknown as ReturnType<typeof createBrowserClient<Database>>
  }
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
