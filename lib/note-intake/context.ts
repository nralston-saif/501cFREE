import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactSearchResult, LinkableRecord } from '@/lib/note-intake-core/server'
import type { Database, GrantProposal, Pri } from '@/lib/supabase/types/database'
import { formatCents } from '@/lib/utils/money'

// Data sources the notes-inbox pipeline reads. Both run under the uploader's
// own session, so RLS decides what Claude can see.

type Client = SupabaseClient<Database>

const SEARCH_LIMIT = 15

type RoleFlags = {
  is_donor: boolean
  is_grantee: boolean
  is_funder: boolean
  is_vendor: boolean
  is_lead: boolean
}

function roles(r: RoleFlags): string[] {
  return [
    r.is_lead && 'lead',
    r.is_donor && 'donor',
    r.is_grantee && 'grantee',
    r.is_funder && 'funder',
    r.is_vendor && 'vendor',
  ].filter((x): x is string => typeof x === 'string')
}

/** Strip characters that would break a PostgREST or() filter. */
function sanitize(query: string): string {
  return query.replace(/[%_,()*\\:"{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

type SearchRow = RoleFlags & {
  id: string
  kind: 'person' | 'organization'
  display_name: string
  email: string | null
  title: string | null
  description: string | null
  affiliations:
    | { title: string | null; end_date: string | null; organization: { display_name: string } | null }[]
    | null
}

/** People and organizations matching a name, email or organization name. */
export async function searchContacts(supabase: Client, rawQuery: string): Promise<ContactSearchResult[]> {
  const query = sanitize(rawQuery)
  if (query.length < 2) return []
  const like = `%${query}%`
  const tokens = query.split(' ').filter((t) => t.length > 1)

  const filters = [`display_name.ilike.${like}`, `name.ilike.${like}`, `email.ilike.${like}`]
  if (tokens.length >= 2) {
    filters.push(`and(first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[tokens.length - 1]}%)`)
  }
  // alternative_emails is an array (stored lower-cased): exact match only
  if (/^[^\s@]+@[^\s@]+$/.test(query)) filters.push(`alternative_emails.cs.{${query.toLowerCase()}}`)

  // Current affiliations of the matched people (as "Title, Organization")
  // come embedded, so the search is one request
  const { data } = await supabase
    .from('contacts')
    .select(
      'id, kind, display_name, email, title, description, is_donor, is_grantee, is_funder, is_vendor, is_lead, affiliations:affiliations!person_id(title, end_date, organization:contacts!organization_id(display_name))'
    )
    .eq('is_active', true)
    .or(filters.join(','))
    .order('display_name')
    .limit(SEARCH_LIMIT)
  const rows = (data ?? []) as unknown as SearchRow[]

  const affiliations = new Map<string, string[]>()
  for (const r of rows) {
    if (r.kind !== 'person') continue
    for (const a of r.affiliations ?? []) {
      const name = a.organization?.display_name
      if (a.end_date || !name) continue
      const list = affiliations.get(r.id) ?? []
      list.push(a.title ? `${a.title}, ${name}` : name)
      affiliations.set(r.id, list)
    }
  }

  return rows.map((r) => {
    const flags = roles(r)
    const detail =
      r.kind === 'person'
        ? [r.email, ...(affiliations.get(r.id) ?? (r.title ? [r.title] : []))]
        : [r.description ? r.description.slice(0, 120) : null]
    if (flags.length) detail.push(flags.join('/'))
    return { id: r.id, kind: r.kind, name: r.display_name, detail: detail.filter(Boolean).join('; ') }
  })
}

/** Grant proposals and PRIs the viewer can see, listed inline for Claude. */
export async function listLinkableRecords(supabase: Client): Promise<LinkableRecord[]> {
  // Applicant and recipient names come embedded (no .in() over up to 400 ids)
  const [proposals, pris] = await Promise.all([
    supabase
      .from('grant_proposals')
      .select(
        'id, title, status, applicant_contact_id, applicant_name, organization_name, applicant:contacts!applicant_contact_id(display_name)'
      )
      .order('entered_date', { ascending: false })
      .limit(200),
    supabase
      .from('pris')
      .select(
        'id, recipient_contact_id, instrument, amount_cents, status, purpose, recipient:contacts!recipient_contact_id(display_name)'
      )
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  type Named = { display_name: string } | null
  const proposalRows = (proposals.data ?? []) as unknown as (Pick<
    GrantProposal,
    'id' | 'title' | 'status' | 'applicant_contact_id' | 'applicant_name' | 'organization_name'
  > & { applicant: Named })[]
  const priRows = (pris.data ?? []) as unknown as (Pick<
    Pri,
    'id' | 'recipient_contact_id' | 'instrument' | 'amount_cents' | 'status' | 'purpose'
  > & { recipient: Named })[]

  return [
    ...proposalRows.map((p) => {
      const applicant =
        (p.applicant_contact_id && p.applicant?.display_name) ||
        p.organization_name ||
        p.applicant_name
      return {
        id: p.id,
        type: 'grant_proposal' as const,
        label: `Grant proposal: ${p.title}`,
        detail: [applicant ? `from ${applicant}` : null, `status ${p.status}`].filter(Boolean).join(', '),
      }
    }),
    ...priRows.map((p) => ({
      id: p.id,
      type: 'pri' as const,
      label: `PRI: ${p.recipient?.display_name ?? 'Unknown recipient'}`,
      detail: [
        `${p.instrument} ${formatCents(p.amount_cents)}`,
        `status ${p.status}`,
        p.purpose ? p.purpose.slice(0, 100) : null,
      ].filter(Boolean).join(', '),
    })),
  ]
}
