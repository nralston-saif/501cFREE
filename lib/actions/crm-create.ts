'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireMemberId, ActionError, actionErrorMessage } from './helpers'
import { findContactIdByEmail, findOrganizationIdByName, escapeLike } from '@/lib/contacts/lookup'
import { normalizeEmail } from '@/lib/contacts/names'
import { ENTITY_TYPE_LABELS, RELATIONSHIP_LABELS, externalUrl, type ContactRoleFlag } from '@/lib/contacts/crm'
import type {
  AffiliationRelationship,
  ContactEntityType,
  ContactKind,
  Database,
  Tag,
} from '@/lib/supabase/types/database'

// Create actions for the Organizations and People lists (the "+ Add" modals).
// Called from client components, so errors come back as { ok: false } rather
// than being thrown.

type Client = Awaited<ReturnType<typeof createClient>>
type ContactInsert = Database['public']['Tables']['contacts']['Insert']

type Fail = { ok: false; error: string }

export type RoleFlags = Partial<Record<ContactRoleFlag, boolean>>

export type NewOrganizationInput = {
  name: string
  entity_type?: ContactEntityType | null
  description?: string | null
  website?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  roles?: RoleFlags
}

export type CreatedContact = { id: string; display_name: string }

export type CreateOrganizationResult = { ok: true; organization: CreatedContact } | Fail

export type NewPersonInput = {
  first_name: string
  last_name?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
  linkedin_url?: string | null
  twitter_url?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  /** Short bio (contacts.description) */
  description?: string | null
  roles?: RoleFlags
  tags?: string[]
  first_met_date?: string | null
  introduced_by?: string | null
  how_we_met?: string | null
  relationship_notes?: string | null
  /** Optionally link the new person to an organization: an existing one by
   * id, or a new one by name (an existing organization with exactly that
   * name is reused). */
  organization?: { id: string } | { name: string } | null
  relationship?: AffiliationRelationship
  /** Title at the organization; defaults to the person's title */
  affiliation_title?: string | null
}

export type CreatePersonResult =
  | {
      ok: true
      person: CreatedContact
      organization: CreatedContact | null
    }
  | Fail

export type DuplicateMatch = {
  id: string
  kind: ContactKind
  display_name: string
  email: string | null
  title: string | null
  /** Why it was flagged */
  reason: 'email' | 'name'
}

export type FindDuplicatesResult = { ok: true; matches: DuplicateMatch[] } | Fail

export type TagOption = Pick<Tag, 'id' | 'name' | 'color'>

export type CreateTagResult = { ok: true; tag: TagOption } | Fail

const ROLE_FLAG_KEYS: ContactRoleFlag[] = ['is_donor', 'is_grantee', 'is_funder', 'is_vendor', 'is_lead']

/** A typed link with https:// added when the scheme is missing. */
function cleanUrl(value: string | null | undefined): string | null {
  const t = clean(value)
  return t ? externalUrl(t) : null
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

function roleFields(roles: RoleFlags | undefined): Record<ContactRoleFlag, boolean> {
  const out = {} as Record<ContactRoleFlag, boolean>
  for (const key of ROLE_FLAG_KEYS) out[key] = roles?.[key] === true
  return out
}

function failure(err: unknown, fallback: string): Fail {
  return { ok: false, error: actionErrorMessage(err, fallback) }
}

/** Tag names are stored trimmed and lower-cased, deduped. */
function tagNames(tags: string[] | undefined): string[] {
  const out = new Set<string>()
  for (const t of tags ?? []) {
    const name = t.trim().toLowerCase()
    if (name) out.add(name)
  }
  return [...out]
}

/** Reject an email another contact already uses (primary or alternative). */
async function assertEmailFree(supabase: Client, email: string | null) {
  const existing = await findContactIdByEmail(supabase, email)
  if (!existing) return
  const { data } = await supabase.from('contacts').select('display_name').eq('id', existing).maybeSingle()
  const who = (data as { display_name: string } | null)?.display_name ?? 'another contact'
  throw new ActionError(`${normalizeEmail(email)} already belongs to ${who}`)
}

async function insertContact(supabase: Client, fields: ContactInsert, memberId: string): Promise<CreatedContact> {
  const { data, error } = await supabase
    .from('contacts')
    .insert({ ...fields, created_by: memberId })
    .select('id, display_name')
    .single()
  if (error) throw new ActionError(error.message)
  return data as CreatedContact
}

function organizationFields(input: NewOrganizationInput): ContactInsert {
  const name = clean(input.name)
  if (!name) throw new ActionError('Organization name is required')
  const entityType = input.entity_type && input.entity_type in ENTITY_TYPE_LABELS ? input.entity_type : null
  return {
    kind: 'organization',
    name,
    entity_type: entityType,
    description: clean(input.description),
    website: cleanUrl(input.website),
    city: clean(input.city),
    state: clean(input.state),
    country: clean(input.country),
    ...roleFields(input.roles),
  }
}

/** Make sure a tag row exists for each name and bump its usage count. Best
 * effort: tags are stored on the contact either way. */
async function recordTagUsage(supabase: Client, names: string[], memberId: string) {
  for (const name of names) {
    const { data } = await supabase
      .from('tags')
      .select('id, usage_count')
      .ilike('name', escapeLike(name))
      .limit(1)
      .maybeSingle()
    const existing = data as { id: string; usage_count: number } | null
    if (existing) {
      await supabase
        .from('tags')
        .update({ usage_count: (existing.usage_count ?? 0) + 1 })
        .eq('id', existing.id)
    } else {
      await supabase.from('tags').insert({ name, usage_count: 1, created_by: memberId })
    }
  }
}

/** Create an organization from the Organizations list. */
export async function createOrganization(input: NewOrganizationInput): Promise<CreateOrganizationResult> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    const organization = await insertContact(supabase, organizationFields(input), memberId)
    revalidatePath('/organizations')
    return { ok: true, organization }
  } catch (err) {
    return failure(err, 'Could not create the organization')
  }
}

/**
 * Create a person from the People list, optionally linking them to an
 * existing or new organization in the same step. If the link can't be made,
 * the person (and any organization created for them) is removed again so a
 * retry doesn't leave duplicates behind.
 */
export async function createPerson(input: NewPersonInput): Promise<CreatePersonResult> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const firstName = clean(input.first_name)
    if (!firstName) throw new ActionError('First name is required')
    const email = clean(input.email)
    await assertEmailFree(supabase, email)

    const relationship: AffiliationRelationship =
      input.relationship && input.relationship in RELATIONSHIP_LABELS ? input.relationship : 'employee'
    const title = clean(input.title)
    const tags = tagNames(input.tags)

    // Resolve the organization before creating anyone
    let organization: CreatedContact | null = null
    let createdOrganization = false
    const org = input.organization
    if (org && 'id' in org && org.id) {
      const { data } = await supabase
        .from('contacts')
        .select('id, display_name, kind')
        .eq('id', org.id)
        .maybeSingle()
      const row = data as (CreatedContact & { kind: string }) | null
      if (!row || row.kind !== 'organization') throw new ActionError('That organization no longer exists')
      organization = { id: row.id, display_name: row.display_name }
    } else if (org && 'name' in org && clean(org.name)) {
      const name = clean(org.name)!
      const existingId = await findOrganizationIdByName(supabase, name)
      if (existingId) {
        organization = { id: existingId, display_name: name }
      } else {
        organization = await insertContact(supabase, organizationFields({ name }), memberId)
        createdOrganization = true
      }
    }

    let person: CreatedContact
    try {
      person = await insertContact(
        supabase,
        {
          kind: 'person',
          first_name: firstName,
          last_name: clean(input.last_name),
          email,
          phone: clean(input.phone),
          title,
          linkedin_url: cleanUrl(input.linkedin_url),
          twitter_url: cleanUrl(input.twitter_url),
          city: clean(input.city),
          state: clean(input.state),
          country: clean(input.country),
          description: clean(input.description),
          tags,
          first_met_date: clean(input.first_met_date),
          introduced_by: clean(input.introduced_by),
          how_we_met: clean(input.how_we_met),
          relationship_notes: clean(input.relationship_notes),
          ...roleFields(input.roles),
        },
        memberId
      )
    } catch (err) {
      if (createdOrganization && organization) {
        await supabase.from('contacts').delete().eq('id', organization.id)
      }
      throw err
    }

    if (organization) {
      const { error } = await supabase.from('affiliations').insert({
        person_id: person.id,
        organization_id: organization.id,
        relationship,
        title: clean(input.affiliation_title) ?? title,
      })
      if (error) {
        await supabase.from('contacts').delete().eq('id', person.id)
        if (createdOrganization) await supabase.from('contacts').delete().eq('id', organization.id)
        throw new ActionError(`Could not link to ${organization.display_name}: ${error.message}`)
      }
    }

    if (tags.length > 0) await recordTagUsage(supabase, tags, memberId)

    revalidatePath('/people')
    if (organization) {
      revalidatePath('/organizations')
      revalidatePath(`/organizations/${organization.id}`)
    }
    return { ok: true, person, organization }
  } catch (err) {
    return failure(err, 'Could not create the person')
  }
}

/** Same first name, and last names that match, start alike, or are missing
 * on one side; or the same full name. */
function similarName(newName: string, existingName: string): boolean {
  const a = newName.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const b = existingName.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (a.length === 0 || b.length === 0) return false
  if (a.join(' ') === b.join(' ')) return true
  if (a[0] !== b[0]) return false
  const [newLast, existingLast] = [a[1], b[1]]
  if (!newLast || !existingLast || newLast === existingLast) return true
  return (
    newLast.length >= 3 &&
    existingLast.length >= 3 &&
    (newLast.startsWith(existingLast) || existingLast.startsWith(newLast))
  )
}

/**
 * People who may already be the person about to be added: anyone using the
 * email (primary or alternative), or a person with a similar name.
 */
export async function findPossibleDuplicates(input: {
  first_name: string
  last_name?: string | null
  email?: string | null
}): Promise<FindDuplicatesResult> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const firstName = clean(input.first_name)
    const fullName = [firstName, clean(input.last_name)].filter(Boolean).join(' ')
    const columns = 'id, display_name, email, title, kind'
    type Row = { id: string; display_name: string; email: string | null; title: string | null; kind: ContactKind }

    const matches = new Map<string, DuplicateMatch>()

    const emailId = await findContactIdByEmail(supabase, input.email)
    if (emailId) {
      const { data } = await supabase.from('contacts').select(columns).eq('id', emailId).maybeSingle()
      const row = data as Row | null
      if (row) matches.set(row.id, { ...pick(row), reason: 'email' })
    }

    if (firstName) {
      const [byFirst, byFull] = await Promise.all([
        supabase
          .from('contacts')
          .select(columns)
          .eq('kind', 'person')
          .ilike('first_name', escapeLike(firstName))
          .limit(50),
        supabase
          .from('contacts')
          .select(columns)
          .eq('kind', 'person')
          .ilike('display_name', escapeLike(fullName))
          .limit(10),
      ])
      const rows = [...((byFirst.data ?? []) as Row[]), ...((byFull.data ?? []) as Row[])]
      for (const row of rows) {
        if (row.kind !== 'person' || matches.has(row.id)) continue
        if (similarName(fullName, row.display_name)) matches.set(row.id, { ...pick(row), reason: 'name' })
      }
    }

    return { ok: true, matches: [...matches.values()].slice(0, 10) }
  } catch (err) {
    return failure(err, 'Could not check for duplicates')
  }
}

function pick(row: { id: string; kind: ContactKind; display_name: string; email: string | null; title: string | null }) {
  return { id: row.id, kind: row.kind, display_name: row.display_name, email: row.email, title: row.title }
}

/** Find a tag by name (ignoring case) or create it, for the tag picker. */
export async function createTag(name: string): Promise<CreateTagResult> {
  try {
    const memberId = await requireMemberId()
    const tagName = name.trim().toLowerCase()
    if (!tagName) throw new ActionError('Enter a tag name')
    const supabase = await createClient()
    const { data: existing } = await supabase
      .from('tags')
      .select('id, name, color')
      .ilike('name', escapeLike(tagName))
      .limit(1)
      .maybeSingle()
    if (existing) return { ok: true, tag: existing as TagOption }

    // Usage is counted when a contact is saved with the tag
    const { data, error } = await supabase
      .from('tags')
      .insert({ name: tagName, usage_count: 0, created_by: memberId })
      .select('id, name, color')
      .single()
    if (error) throw new ActionError(error.message)
    return { ok: true, tag: data as TagOption }
  } catch (err) {
    return failure(err, 'Could not create the tag')
  }
}
