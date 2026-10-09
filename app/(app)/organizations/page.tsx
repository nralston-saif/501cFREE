import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { signContactImages } from '@/lib/contacts/images'
import { LEADERSHIP_RELATIONSHIPS } from '@/lib/contacts/crm'
import type { Affiliation, Contact } from '@/lib/supabase/types/database'
import CreateTicketButton from '@/components/CreateTicketButton'
import OrganizationGrid, { type OrganizationCard } from './OrganizationGrid'

export const dynamic = 'force-dynamic'

type Client = Awaited<ReturnType<typeof createClient>>

type OrgRow = Pick<
  Contact,
  | 'id'
  | 'display_name'
  | 'description'
  | 'website'
  | 'city'
  | 'state'
  | 'country'
  | 'entity_type'
  | 'image_path'
  | 'tags'
  | 'previous_names'
  | 'is_active'
  | 'is_donor'
  | 'is_grantee'
  | 'is_funder'
  | 'is_vendor'
  | 'is_lead'
>

type LeadershipRow = Pick<Affiliation, 'id' | 'person_id' | 'organization_id' | 'relationship' | 'end_date'> & {
  person: { display_name: string } | null
}

/** Signed logo URLs; storage being unavailable just means initials. */
async function logoUrls(supabase: Client, paths: (string | null)[]): Promise<Map<string, string>> {
  try {
    return await signContactImages(supabase, paths)
  } catch {
    return new Map()
  }
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>
}) {
  const { add } = await searchParams
  const supabase = await createClient()

  const [orgs, affiliations, totals] = await Promise.all([
    fetchAll<OrgRow>(() =>
      supabase
        .from('contacts')
        .select(
          'id, display_name, description, website, city, state, country, entity_type, image_path, tags, previous_names, is_active, is_donor, is_grantee, is_funder, is_vendor, is_lead'
        )
        .eq('kind', 'organization')
        .order('display_name')
        .order('id')
    ),
    // Current leadership only, with the person's name embedded
    fetchAll<LeadershipRow>(() =>
      supabase
        .from('affiliations')
        .select('id, person_id, organization_id, relationship, end_date, person:contacts!person_id(display_name)')
        .in('relationship', LEADERSHIP_RELATIONSHIPS)
        .is('end_date', null)
        .order('id')
    ),
    // Granted / donated / PRI totals per organization, summed in Postgres
    fetchAll(() => supabase.rpc('contact_money_totals', { p_kind: 'organization' }).order('contact_id')),
  ])

  const logos = await logoUrls(
    supabase,
    orgs.map((o) => o.image_path)
  )

  const leadership = new Map<string, { id: string; name: string }[]>()
  for (const a of affiliations) {
    if (a.end_date || !LEADERSHIP_RELATIONSHIPS.includes(a.relationship)) continue
    const name = a.person?.display_name
    if (!name) continue
    const list = leadership.get(a.organization_id) ?? []
    if (!list.some((p) => p.id === a.person_id)) list.push({ id: a.person_id, name })
    leadership.set(a.organization_id, list)
  }

  const money = new Map(totals.map((t) => [t.contact_id, t]))

  const cards: OrganizationCard[] = orgs.map((o) => ({
    ...o,
    tags: o.tags ?? [],
    previous_names: o.previous_names ?? [],
    logo_url: o.image_path ? logos.get(o.image_path) ?? null : null,
    leadership: (leadership.get(o.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    granted_cents: Number(money.get(o.id)?.granted_cents ?? 0),
    donated_cents: Number(money.get(o.id)?.donated_cents ?? 0),
    pri_cents: Number(money.get(o.id)?.pri_cents ?? 0),
  }))

  return (
    <OrganizationGrid
      organizations={cards}
      openAdd={add === '1'}
      ticketButton={<CreateTicketButton />}
    />
  )
}
