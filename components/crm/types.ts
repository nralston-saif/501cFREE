import type { Affiliation, Contact } from '@/lib/supabase/types/database'

// Props shapes passed from the detail pages' server components to their
// client views. Type-only.

export type AffiliationFields = Pick<
  Affiliation,
  'id' | 'relationship' | 'title' | 'is_primary_contact' | 'start_date' | 'end_date'
>

/** A person at an organization (Organization page: Leadership and Team). */
export type OrgMember = AffiliationFields & {
  person: Pick<
    Contact,
    | 'id'
    | 'display_name'
    | 'title'
    | 'description'
    | 'city'
    | 'state'
    | 'country'
    | 'linkedin_url'
    | 'twitter_url'
    | 'email'
  > & { imageUrl: string | null }
}

/** An organization a person belongs to (Person page). */
export type PersonOrg = AffiliationFields & {
  organization: Pick<Contact, 'id' | 'display_name'> & { imageUrl: string | null }
}

export function locationOf(c: Pick<Contact, 'city' | 'state' | 'country'>): string {
  return [c.city, c.state, c.country].filter(Boolean).join(', ')
}

export function ensureProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}
