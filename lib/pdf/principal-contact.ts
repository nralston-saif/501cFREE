import type { SupabaseClient } from '@supabase/supabase-js'
import type { Contact, Database } from '@/lib/supabase/types/database'

export type PrincipalPerson = Pick<Contact, 'first_name' | 'last_name' | 'display_name' | 'email'>

/**
 * The person a letter or memorandum about an organization is addressed to:
 * its primary affiliated contact (affiliations.is_primary_contact). Null for
 * people, or when no primary contact is recorded.
 */
export async function loadPrincipalPerson(
  supabase: SupabaseClient<Database>,
  contact: Pick<Contact, 'id' | 'kind'>
): Promise<PrincipalPerson | null> {
  if (contact.kind !== 'organization') return null
  const { data } = await supabase
    .from('affiliations')
    .select('person:contacts!person_id(first_name, last_name, display_name, email)')
    .eq('organization_id', contact.id)
    .eq('is_primary_contact', true)
    .limit(1)
    .maybeSingle()
  return (data as unknown as { person: PrincipalPerson | null } | null)?.person ?? null
}
