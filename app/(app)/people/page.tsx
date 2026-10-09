import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { signContactImages } from '@/lib/contacts/images'
import type { Affiliation, Contact, Tag } from '@/lib/supabase/types/database'
import CreateTicketButton from '@/components/CreateTicketButton'
import PeopleClient, { type PersonCard } from './PeopleClient'

export const dynamic = 'force-dynamic'

type Client = Awaited<ReturnType<typeof createClient>>

type PersonRow = Pick<
  Contact,
  | 'id'
  | 'display_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'alternative_emails'
  | 'title'
  | 'description'
  | 'image_path'
  | 'linkedin_url'
  | 'city'
  | 'state'
  | 'country'
  | 'tags'
  | 'is_active'
  | 'is_donor'
  | 'is_grantee'
  | 'is_funder'
  | 'is_vendor'
  | 'is_lead'
  | 'created_at'
>

type AffiliationRow = Pick<
  Affiliation,
  'person_id' | 'organization_id' | 'relationship' | 'title' | 'is_primary_contact' | 'end_date' | 'created_at'
>

/** Signed photo URLs; storage being unavailable just means initials. */
async function photoUrls(supabase: Client, paths: (string | null)[]): Promise<Map<string, string>> {
  try {
    return await signContactImages(supabase, paths)
  } catch {
    return new Map()
  }
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string; search?: string }>
}) {
  const { add, search } = await searchParams
  const supabase = await createClient()

  const [people, affiliations, organizations, noteCounts, tags] = await Promise.all([
    fetchAll<PersonRow>(() =>
      supabase
        .from('contacts')
        .select(
          'id, display_name, first_name, last_name, email, alternative_emails, title, description, image_path, linkedin_url, city, state, country, tags, is_active, is_donor, is_grantee, is_funder, is_vendor, is_lead, created_at'
        )
        .eq('kind', 'person')
        .order('display_name')
        .order('id')
    ),
    fetchAll<AffiliationRow>(() =>
      supabase
        .from('affiliations')
        .select('person_id, organization_id, relationship, title, is_primary_contact, end_date, created_at')
        .order('id')
    ),
    fetchAll<Pick<Contact, 'id' | 'display_name' | 'is_active'>>(() =>
      supabase.from('contacts').select('id, display_name, is_active').eq('kind', 'organization').order('display_name').order('id')
    ),
    // Distinct notes per contact, counted in Postgres
    fetchAll(() => supabase.rpc('contact_note_counts').order('contact_id')),
    fetchAll<Pick<Tag, 'id' | 'name' | 'color'>>(() =>
      supabase
        .from('tags')
        .select('id, name, color, usage_count')
        .order('usage_count', { ascending: false })
        .order('name')
        .order('id')
    ),
  ])

  const photos = await photoUrls(
    supabase,
    people.map((p) => p.image_path)
  )

  const notesByContact = new Map(noteCounts.map((n) => [n.contact_id, Number(n.note_count)]))

  const orgNames = new Map(organizations.map((o) => [o.id, o.display_name]))
  const affiliationsByPerson = new Map<string, PersonCard['affiliations']>()
  for (const a of affiliations) {
    const name = orgNames.get(a.organization_id)
    if (!name) continue
    const list = affiliationsByPerson.get(a.person_id) ?? []
    list.push({
      organization_id: a.organization_id,
      organization_name: name,
      relationship: a.relationship,
      title: a.title,
      is_primary_contact: a.is_primary_contact,
      current: !a.end_date,
      created_at: a.created_at,
    })
    affiliationsByPerson.set(a.person_id, list)
  }

  const cards: PersonCard[] = people.map((p) => ({
    ...p,
    alternative_emails: p.alternative_emails ?? [],
    tags: p.tags ?? [],
    photo_url: p.image_path ? photos.get(p.image_path) ?? null : null,
    // Current, primary-contact links first, then oldest first
    affiliations: (affiliationsByPerson.get(p.id) ?? []).sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        Number(b.is_primary_contact) - Number(a.is_primary_contact) ||
        a.created_at.localeCompare(b.created_at)
    ),
    note_count: notesByContact.get(p.id) ?? 0,
  }))

  return (
    <PeopleClient
      // A new ?search= (e.g. from global search) starts a fresh list state
      key={search ?? ''}
      people={cards}
      organizations={organizations
        .filter((o) => o.is_active)
        .map((o) => ({ id: o.id, name: o.display_name }))}
      tags={tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      }))}
      initialSearch={search ?? ''}
      openAdd={add === '1'}
      ticketButton={<CreateTicketButton />}
    />
  )
}
