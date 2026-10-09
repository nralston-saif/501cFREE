import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'
import { normalizeEmail } from './names'

// Duplicate checks shared by every path that creates contacts (the contact
// form, inline pickers, donation inquiries, the notes inbox).

type Client = SupabaseClient<Database>

/** Escape LIKE wildcards so a value matches literally under ilike. */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

/**
 * The contact that already uses this email, as its primary email or one of
 * its alternative_emails, or null. Case-insensitive on the primary email;
 * alternative emails are stored lower-cased by the app.
 */
export async function findContactIdByEmail(
  supabase: Client,
  email: string | null | undefined,
  excludeId?: string
): Promise<string | null> {
  const e = normalizeEmail(email)
  if (!e) return null
  const [primary, alternative] = await Promise.all([
    supabase.from('contacts').select('id').ilike('email', escapeLike(e)).limit(2),
    supabase.from('contacts').select('id').contains('alternative_emails', [e]).limit(2),
  ])
  const rows = [...(primary.data ?? []), ...(alternative.data ?? [])] as { id: string }[]
  return rows.find((r) => r.id !== excludeId)?.id ?? null
}

/** An organization whose name matches exactly (ignoring case), or null. */
export async function findOrganizationIdByName(supabase: Client, name: string): Promise<string | null> {
  const n = name.trim()
  if (!n) return null
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('kind', 'organization')
    .ilike('name', escapeLike(n))
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
