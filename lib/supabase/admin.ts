import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database'
import { createDemoClient, isDemoMode } from './demo/mock-client'

/**
 * Service-role client for server-only operations that bypass RLS
 * (letter PDF uploads, signed URL generation). Never import in client code.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (isDemoMode()) {
    return createDemoClient() as unknown as SupabaseClient<Database>
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
