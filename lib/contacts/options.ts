import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactKind, Database } from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'

// Contact pickers (recipient, donor, grantee, vendor selects) need every
// matching contact, and a plain select stops at PostgREST's max_rows. This
// pages through all of them, fetching only the id and name.

export type ContactOption = { id: string; display_name: string }

export type ContactOptionsFilter = {
  /** Only contacts flagged as vendors (is_vendor) */
  vendorsOnly?: boolean
  /** Only people or only organizations */
  kind?: ContactKind
  /** Only active contacts (is_active) */
  activeOnly?: boolean
  /** Rows per request; tests only */
  pageSize?: number
}

/** Every contact matching `filter` as `{ id, display_name }`, by name. Throws on a query error. */
export async function loadContactOptions(
  supabase: SupabaseClient<Database>,
  filter: ContactOptionsFilter = {}
): Promise<ContactOption[]> {
  const { vendorsOnly, kind, activeOnly, pageSize } = filter
  return fetchAll<ContactOption>(
    () => {
      let query = supabase.from('contacts').select('id, display_name')
      if (vendorsOnly) query = query.eq('is_vendor', true)
      if (kind) query = query.eq('kind', kind)
      if (activeOnly) query = query.eq('is_active', true)
      return query.order('display_name').order('id')
    },
    pageSize ? { pageSize } : {}
  )
}
