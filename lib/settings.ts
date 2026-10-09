import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { Database, OrgSettings } from '@/lib/supabase/types/database'
import { todayInTimeZone } from '@/lib/utils/dates'

/**
 * The organization's settings row (singleton, edited at /settings). Cached
 * per request. Pass a client when calling from a context without a user
 * session (cron jobs, public endpoints use the admin client).
 */
export function getOrgSettings(client?: SupabaseClient<Database>): Promise<OrgSettings> {
  // React's cache() keys on its arguments, and every createClient() call
  // returns a new client object, so caching on the client would miss each
  // time a page and its components pass their own. The row is the same for
  // any client that can read it, so share one load per request.
  const slot = settingsSlot()
  slot.promise ??= loadOrgSettings(client).catch((err) => {
    slot.promise = null
    throw err
  })
  return slot.promise
}

/** One slot per server request (outside a request, e.g. in tests, a fresh one per call) */
const settingsSlot = cache((): { promise: Promise<OrgSettings> | null } => ({ promise: null }))

async function loadOrgSettings(client?: SupabaseClient<Database>): Promise<OrgSettings> {
  const supabase = client ?? (await createClient())
  const { data, error } = await supabase.from('org_settings').select('*').eq('id', 1).single()
  if (error || !data) throw new Error(`Organization settings are missing: ${error?.message ?? 'no row'}`)
  return data as OrgSettings
}

/** Short name for the UI and email sign-offs, falling back to the legal name. */
export function orgName(settings: Pick<OrgSettings, 'org_display_name' | 'org_legal_name'>): string {
  return settings.org_display_name || settings.org_legal_name || 'Our organization'
}

/**
 * Today as YYYY-MM-DD in the organization's time zone (org_settings.timezone).
 * Use for "entered"/"received" dates stamped by the server, which otherwise
 * follow the server's clock (UTC on most hosts).
 */
export async function orgToday(client?: SupabaseClient<Database>): Promise<string> {
  const settings = await getOrgSettings(client)
  return todayInTimeZone(settings.timezone)
}
