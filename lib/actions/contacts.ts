'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll, fetchByKeys, IN_CHUNK_SIZE } from '@/lib/supabase/fetch-all'
import { orgToday } from '@/lib/settings'
import { requireMemberId, ActionError, runAction, type ActionResult, actionErrorMessage } from './helpers'
import { vendorFieldsFromInput, type NewVendorInput } from './vendor-fields'
import { applicantFieldsFromInput, type NewApplicantInput } from './applicant-fields'
import { findContactIdByEmail, escapeLike } from '@/lib/contacts/lookup'
import { normalizeEmail } from '@/lib/contacts/names'
import {
  CONTACT_IMAGE_TYPES,
  MAX_CONTACT_IMAGE_BYTES,
  contactImageFolder,
  isContactImagePath,
  ROLE_FLAGS,
  type ContactRoleFlag,
} from '@/lib/contacts/crm'
import type {
  AffiliationRelationship,
  ContactEntityType,
  ContactKind,
  ContactTaxStatus,
  Database,
} from '@/lib/supabase/types/database'

type ContactInsert = Database['public']['Tables']['contacts']['Insert']
type ContactUpdate = Database['public']['Tables']['contacts']['Update']
type Client = Awaited<ReturnType<typeof createClient>>

/** Result for actions called from client components. */
export type ContactActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export type CreateVendorResult =
  | { ok: true; vendor: { id: string; display_name: string } }
  | { ok: false; error: string }

export type CreateApplicantResult =
  | { ok: true; applicant: { id: string; display_name: string } }
  | { ok: false; error: string }

const AFFILIATION_RELATIONSHIPS: AffiliationRelationship[] = [
  'contact',
  'employee',
  'founder',
  'executive',
  'board_member',
  'advisor',
  'other',
]

const ENTITY_TYPES: ContactEntityType[] = ['nonprofit', 'for_profit', 'pbc', 'government', 'other']

const TAX_STATUSES: ContactTaxStatus[] = [
  '501c3_public_charity',
  '501c3_private_foundation',
  'other_nonprofit',
  'government',
  'for_profit',
  'individual',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Deletes by id in chunks, so a long id list never overflows the request URL. */
async function deleteByIds(
  ids: string[],
  remove: (chunk: string[]) => PromiseLike<{ error: { message: string } | null }>
): Promise<void> {
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const { error } = await remove(ids.slice(i, i + IN_CHUNK_SIZE))
    if (error) throw new Error(error.message)
  }
}

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: actionErrorMessage(err, fallback) }
}

/** The detail page for a contact of a known kind. */
function contactPath(kind: ContactKind, id: string): string {
  return kind === 'person' ? `/people/${id}` : `/organizations/${id}`
}

function revalidateContact(kind: ContactKind, id: string) {
  revalidatePath(kind === 'person' ? '/people' : '/organizations')
  revalidatePath(contactPath(kind, id))
}

/** Emails typed one per line or separated by commas, lower-cased, deduped. */
function emailList(value: string | null, primary: string | null): string[] {
  if (!value) return []
  const out = new Set<string>()
  for (const part of value.split(/[\s,;]+/)) {
    const e = normalizeEmail(part)
    if (e && e !== primary) out.add(e)
  }
  return [...out]
}

/** Reject an email (primary or alternative) another contact already uses. */
async function assertEmailsFree(
  supabase: Client,
  fields: Pick<ContactInsert, 'email' | 'alternative_emails'>,
  excludeId?: string
) {
  const emails = [fields.email ?? null, ...(fields.alternative_emails ?? [])]
  for (const email of emails) {
    const existing = await findContactIdByEmail(supabase, email, excludeId)
    if (existing) {
      const { data } = await supabase.from('contacts').select('display_name').eq('id', existing).maybeSingle()
      const who = (data as { display_name: string } | null)?.display_name ?? 'another contact'
      throw new ActionError(`${email} already belongs to ${who}`)
    }
  }
}

async function insertContact(supabase: Client, fields: ContactInsert, memberId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({ ...fields, created_by: memberId })
    .select('id, display_name')
    .single()
  if (error) throw new ActionError(error.message)
  return data as { id: string; display_name: string }
}

async function contactKind(supabase: Client, contactId: string): Promise<ContactKind> {
  const { data } = await supabase.from('contacts').select('kind').eq('id', contactId).maybeSingle()
  const row = data as { kind: ContactKind } | null
  if (!row) throw new ActionError('Contact not found')
  return row.kind
}

/**
 * Create a vendor contact from the inline picker on the expense form and return
 * it (no redirect), so the caller can select it without losing the form. Errors
 * are returned, not thrown, so the inline UI can show them in place.
 */
export async function createVendorInline(input: NewVendorInput): Promise<CreateVendorResult> {
  try {
    const memberId = await requireMemberId()
    if (!input.name?.trim()) {
      return { ok: false, error: 'Vendor name is required' }
    }

    const supabase = await createClient()
    const fields = vendorFieldsFromInput(input)
    const vendor = await insertContact(supabase, fields, memberId)

    revalidatePath(fields.kind === 'person' ? '/people' : '/organizations')
    revalidatePath('/expenses')
    return { ok: true, vendor }
  } catch (err) {
    return { ok: false, error: actionErrorMessage(err, 'Could not create vendor') }
  }
}

/**
 * Create a grantee contact from the inline picker on the new-proposal form and
 * return it (no redirect), so the caller can immediately select it without
 * losing the form. Errors are returned, not thrown, so the inline UI can show
 * them in place.
 */
export async function createApplicantInline(
  input: NewApplicantInput
): Promise<CreateApplicantResult> {
  try {
    const memberId = await requireMemberId()
    if (!input.name?.trim()) {
      return { ok: false, error: 'Applicant name is required' }
    }

    const supabase = await createClient()
    const fields = applicantFieldsFromInput(input)
    const applicant = await insertContact(supabase, fields, memberId)

    revalidatePath(fields.kind === 'person' ? '/people' : '/organizations')
    revalidatePath('/grants-out')
    return { ok: true, applicant }
  } catch (err) {
    return {
      ok: false,
      error: actionErrorMessage(err, 'Could not create applicant'),
    }
  }
}

export type ContactSearchHit = {
  id: string
  display_name: string
  kind: ContactKind
  email: string | null
  title: string | null
}

/** Type-ahead search over contact names and emails, for pickers. */
export async function searchContacts(query: string, kind?: ContactKind): Promise<ActionResult<ContactSearchHit[]>> {
  return runAction(async () => {
    await requireMemberId()
    const q = query.trim()
    if (q.length < 2) return []
    const supabase = await createClient()
    const pattern = `%${escapeLike(q)}%`
    let request = supabase
      .from('contacts')
      .select('id, display_name, kind, email, title')
      .or(`display_name.ilike.${JSON.stringify(pattern)},email.ilike.${JSON.stringify(pattern)}`)
      .order('display_name')
      .limit(20)
    if (kind) request = request.eq('kind', kind)
    const { data } = await request
    return ((data ?? []) as ContactSearchHit[]).map((h) => ({ ...h, title: h.title ?? null }))
  })
}

// Profile edits (Organization and Person pages) --------------------------------

type Text = string | null | undefined

/** Fields both kinds share on the edit forms. */
type SharedProfileInput = {
  description?: Text
  email?: Text
  /** Comma/space separated, or a list */
  alternative_emails?: string | string[]
  phone?: Text
  address_line1?: Text
  address_line2?: Text
  city?: Text
  state?: Text
  postal_code?: Text
  country?: Text
  legal_name?: Text
  tax_id?: Text
  tax_status?: ContactTaxStatus | '' | null
  w9_on_file?: boolean
  is_active?: boolean
  tags?: string[]
  roles?: Partial<Record<ContactRoleFlag, boolean>>
}

export type OrganizationInput = SharedProfileInput & {
  name: string
  /** Former names, comma separated or a list */
  previous_names?: string | string[]
  website?: Text
  entity_type?: ContactEntityType | '' | null
}

export type PersonInput = SharedProfileInput & {
  first_name?: Text
  last_name?: Text
  title?: Text
  linkedin_url?: Text
  twitter_url?: Text
  introduced_by?: Text
  first_met_date?: Text
  how_we_met?: Text
  relationship_notes?: Text
}

function text(value: Text): string | null {
  const t = value?.trim()
  return t ? t : null
}

function list(value: string | string[] | undefined): string[] {
  const parts = Array.isArray(value) ? value : (value ?? '').split(',')
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))]
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

/** Validate the shared fields present in `input` into a contacts update. */
function sharedFields(input: SharedProfileInput): ContactUpdate {
  const out: ContactUpdate = {}
  if ('description' in input) out.description = text(input.description)
  if ('email' in input) out.email = text(input.email)
  if ('alternative_emails' in input) {
    const raw = Array.isArray(input.alternative_emails)
      ? input.alternative_emails.join(',')
      : (input.alternative_emails ?? '')
    out.alternative_emails = emailList(raw, normalizeEmail(out.email ?? input.email ?? null))
  }
  for (const key of [
    'phone',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'country',
    'legal_name',
    'tax_id',
  ] as const) {
    if (key in input) out[key] = text(input[key])
  }
  if ('tax_status' in input) {
    const status = input.tax_status || null
    if (status && !TAX_STATUSES.includes(status)) throw new ActionError('Unknown tax status')
    out.tax_status = status
  }
  if (input.w9_on_file !== undefined) out.w9_on_file = input.w9_on_file
  if (input.is_active !== undefined) out.is_active = input.is_active
  if (input.tags !== undefined) out.tags = cleanTags(input.tags)
  for (const { flag } of ROLE_FLAGS) {
    const value = input.roles?.[flag]
    if (value !== undefined) out[flag] = value
  }
  return out
}

function url(value: Text): string | null {
  const t = text(value)
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/** Count each newly applied tag once toward its usage (orders the picker). */
async function bumpTagUsage(supabase: Client, added: string[]) {
  if (added.length === 0) return
  const { data } = await supabase.from('tags').select('id, usage_count').in('name', added)
  await Promise.all(
    ((data ?? []) as { id: string; usage_count: number }[]).map((t) =>
      supabase.from('tags').update({ usage_count: t.usage_count + 1 }).eq('id', t.id)
    )
  )
}

/** Shared write path for both profile forms. */
async function saveProfile(
  contactId: string,
  expectedKind: ContactKind,
  fields: ContactUpdate
): Promise<void> {
  await requireMemberId()
  const supabase = await createClient()
  const { data } = await supabase.from('contacts').select('kind, email, tags').eq('id', contactId).maybeSingle()
  const before = data as { kind: ContactKind; email: string | null; tags: string[] } | null
  if (!before) throw new ActionError('Contact not found')
  if (before.kind !== expectedKind) {
    throw new ActionError(`This contact is not ${expectedKind === 'person' ? 'a person' : 'an organization'}`)
  }

  if (fields.email !== undefined || fields.alternative_emails !== undefined) {
    await assertEmailsFree(
      supabase,
      { email: fields.email ?? null, alternative_emails: fields.alternative_emails ?? [] },
      contactId
    )
  }

  const { error } = await supabase.from('contacts').update(fields).eq('id', contactId)
  if (error) throw new ActionError(error.message)

  if (fields.tags) await bumpTagUsage(supabase, fields.tags.filter((t) => !before.tags.includes(t)))
  revalidateContact(expectedKind, contactId)
}

export async function updateOrganization(
  contactId: string,
  input: OrganizationInput
): Promise<ContactActionResult> {
  try {
    const name = text(input.name)
    if (!name) throw new ActionError('Organization name is required')
    const entityType = input.entity_type || null
    if (entityType && !ENTITY_TYPES.includes(entityType)) throw new ActionError('Unknown entity type')

    const fields: ContactUpdate = {
      ...sharedFields(input),
      name,
      entity_type: entityType,
    }
    if ('previous_names' in input) fields.previous_names = list(input.previous_names)
    if ('website' in input) fields.website = url(input.website)

    await saveProfile(contactId, 'organization', fields)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not save the organization')
  }
}

export async function updatePerson(contactId: string, input: PersonInput): Promise<ContactActionResult> {
  try {
    const fields: ContactUpdate = sharedFields(input)
    // A person's display name comes from first + last (contacts.name is only
    // the fallback for imported rows), so the form doesn't write name
    for (const key of ['first_name', 'last_name', 'title', 'how_we_met', 'relationship_notes'] as const) {
      if (key in input) fields[key] = text(input[key])
    }
    if ('linkedin_url' in input) fields.linkedin_url = url(input.linkedin_url)
    if ('twitter_url' in input) fields.twitter_url = url(input.twitter_url)
    if ('first_met_date' in input) {
      const date = text(input.first_met_date)
      if (date && !DATE_RE.test(date)) throw new ActionError('Invalid first-met date')
      fields.first_met_date = date
    }
    if ('introduced_by' in input) {
      const introducer = text(input.introduced_by)
      if (introducer === contactId) throw new ActionError("Someone can't introduce themselves")
      fields.introduced_by = introducer
    }
    if (('first_name' in input || 'last_name' in input) && !fields.first_name && !fields.last_name) {
      throw new ActionError('Enter a first or last name')
    }

    await saveProfile(contactId, 'person', fields)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not save the profile')
  }
}

// Logo / photo -----------------------------------------------------------------

/**
 * Upload a logo (organization) or photo (person) to the private documents
 * bucket under contact-images/{id}/ and point image_path at it. The previous
 * image object is removed.
 */
export async function uploadContactImage(
  contactId: string,
  formData: FormData
): Promise<ContactActionResult<{ imagePath: string }>> {
  try {
    await requireMemberId()
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ActionError('No file provided')
    if (!CONTACT_IMAGE_TYPES.includes(file.type)) throw new ActionError('Choose a PNG, JPEG, WebP or GIF image')
    if (file.size > MAX_CONTACT_IMAGE_BYTES) throw new ActionError('Images must be 5 MB or smaller')

    const supabase = await createClient()
    const { data } = await supabase.from('contacts').select('kind, image_path').eq('id', contactId).maybeSingle()
    const contact = data as { kind: ContactKind; image_path: string | null } | null
    if (!contact) throw new ActionError('Contact not found')

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
    const path = `${contactImageFolder(contactId)}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type })
    if (uploadError) throw new ActionError(`Upload failed: ${uploadError.message}`)

    const { error } = await supabase.from('contacts').update({ image_path: path }).eq('id', contactId)
    if (error) {
      await supabase.storage.from('documents').remove([path])
      throw new ActionError(error.message)
    }
    // Only ever remove objects in this contact's own image folder
    if (isContactImagePath(contactId, contact.image_path) && contact.image_path !== path) {
      await supabase.storage.from('documents').remove([contact.image_path])
    }

    revalidateContact(contact.kind, contactId)
    return { ok: true, imagePath: path }
  } catch (err) {
    return fail(err, 'Could not upload the image')
  }
}

export async function removeContactImage(contactId: string): Promise<ContactActionResult> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data } = await supabase.from('contacts').select('kind, image_path').eq('id', contactId).maybeSingle()
    const contact = data as { kind: ContactKind; image_path: string | null } | null
    if (!contact) throw new ActionError('Contact not found')
    if (contact.image_path) {
      const { error } = await supabase.from('contacts').update({ image_path: null }).eq('id', contactId)
      if (error) throw new ActionError(error.message)
      if (isContactImagePath(contactId, contact.image_path)) {
        await supabase.storage.from('documents').remove([contact.image_path])
      }
    }
    revalidateContact(contact.kind, contactId)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not remove the image')
  }
}

// Delete -------------------------------------------------------------------------

/**
 * Delete a contact. Contributions, grants, proposals, PRIs and expenses keep
 * their contact (no cascade), so a contact with financial records can't be
 * deleted; archive it instead. Affiliations and meeting attendance cascade;
 * the contact's files, logo and note links are cleaned up here, along with
 * notes that were linked to nothing else (whoever wrote them, since the record
 * they were about is gone) and those notes' filed originals.
 */
export async function deleteContact(contactId: string): Promise<ContactActionResult<{ kind: ContactKind }>> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data } = await supabase.from('contacts').select('kind, image_path').eq('id', contactId).maybeSingle()
    const contact = data as { kind: ContactKind; image_path: string | null } | null
    if (!contact) throw new ActionError('Contact not found')

    // Every row (a long-standing contact can pass max_rows), read before the
    // delete since the links go with it
    const [attachments, linkRows] = await Promise.all([
      fetchAll<{ id: string; storage_path: string }>(() =>
        supabase
          .from('attachments')
          .select('id, storage_path')
          .eq('entity_type', 'contact')
          .eq('entity_id', contactId)
          .order('id')
      ),
      fetchAll<{ note_id: string }>(() =>
        supabase.from('note_links').select('id, note_id').eq('entity_type', 'contact').eq('entity_id', contactId).order('id')
      ),
    ])

    const { error } = await supabase.from('contacts').delete().eq('id', contactId)
    if (error) {
      if (error.code === '23503') {
        throw new ActionError(
          `This ${contact.kind === 'person' ? 'person' : 'organization'} has contributions, grants, proposals, PRIs or expenses on file, so it can't be deleted. Archive it instead.`
        )
      }
      throw new ActionError(error.message)
    }

    // Cleanup after the delete succeeds, so a blocked delete leaves everything in place
    const objects = [
      ...attachments.map((a) => a.storage_path),
      ...(isContactImagePath(contactId, contact.image_path) ? [contact.image_path] : []),
    ]
    if (objects.length > 0) await supabase.storage.from('documents').remove(objects)

    const noteIds = [...new Set(linkRows.map((l) => l.note_id))]
    // Best-effort: the contact is already gone, so a failed lookup here only
    // skips cleanup (it never guesses which notes are orphaned)
    try {
      await deleteByIds(attachments.map((a) => a.id), (ids) => supabase.from('attachments').delete().in('id', ids))
      if (noteIds.length > 0) {
        await supabase.from('note_links').delete().eq('entity_type', 'contact').eq('entity_id', contactId)
        // Chunked, and throws rather than returning a partial list: a missed
        // link would make a still-linked note look orphaned and delete it
        const remaining = await fetchByKeys<{ note_id: string }, string>(noteIds, (ids) =>
          supabase.from('note_links').select('note_id').in('note_id', ids)
        )
        const stillLinked = new Set(remaining.map((l) => l.note_id))
        const orphans = noteIds.filter((id) => !stillLinked.has(id))
        if (orphans.length > 0) {
          // Files filed with those notes go too, unless another note still
          // points at the same object
          const fileRows = await fetchByKeys<{ storage_path: string }, string>(orphans, (ids) =>
            supabase.from('note_attachments').select('storage_path').in('note_id', ids)
          )
          const paths = [...new Set(fileRows.map((f) => f.storage_path))]
          await deleteByIds(orphans, (ids) => supabase.from('notes').delete().in('id', ids))
          if (paths.length > 0) {
            const stillAttached = await fetchByKeys<{ storage_path: string }, string>(paths, (chunk) =>
              supabase.from('note_attachments').select('storage_path').in('storage_path', chunk)
            )
            const inUse = new Set(stillAttached.map((f) => f.storage_path))
            const unused = paths.filter((p) => !inUse.has(p))
            // Service role: storage RLS only lets an upload's owner delete it,
            // and the notes it belonged to are already gone
            if (unused.length > 0) await createAdminClient().storage.from('note-files').remove(unused)
          }
        }
      }
    } catch (err) {
      console.error('Contact note cleanup failed', err)
    }

    revalidatePath(contact.kind === 'person' ? '/people' : '/organizations')
    return { ok: true, kind: contact.kind }
  } catch (err) {
    return fail(err, 'Could not delete')
  }
}

// Affiliations: people belong to organizations ---------------------------------

export type AffiliationResult = { ok: true } | { ok: false; error: string }

function revalidateAffiliation(row: { person_id: string; organization_id: string }) {
  revalidatePath(`/people/${row.person_id}`)
  revalidatePath(`/organizations/${row.organization_id}`)
}

/** Only one primary contact per organization. */
async function clearOtherPrimaries(supabase: Client, organizationId: string, keepId: string) {
  await supabase
    .from('affiliations')
    .update({ is_primary_contact: false })
    .eq('organization_id', organizationId)
    .eq('is_primary_contact', true)
    .neq('id', keepId)
}

function affiliationError(error: { code?: string; message: string }): ActionError {
  return new ActionError(
    error.code === '23505' ? 'This person already has that relationship with the organization' : error.message
  )
}

/**
 * Link a person to an organization. Either detail page can call this;
 * `contactId` is the page's contact and `otherId` the one picked, and the
 * kinds decide which is the person.
 */
export async function addAffiliation(input: {
  contactId: string
  otherId: string
  relationship: AffiliationRelationship
  title?: string | null
  isPrimaryContact?: boolean
  startDate?: string | null
}): Promise<AffiliationResult> {
  try {
    await requireMemberId()
    if (!AFFILIATION_RELATIONSHIPS.includes(input.relationship)) {
      throw new ActionError('Unknown relationship')
    }
    if (input.startDate && !DATE_RE.test(input.startDate)) throw new ActionError('Invalid start date')
    const supabase = await createClient()
    const { data } = await supabase
      .from('contacts')
      .select('id, kind')
      .in('id', [input.contactId, input.otherId])
    const rows = (data ?? []) as { id: string; kind: ContactKind }[]
    const person = rows.find((r) => r.kind === 'person')
    const org = rows.find((r) => r.kind === 'organization')
    if (!person || !org) throw new ActionError('Link a person to an organization')

    const { data: created, error } = await supabase
      .from('affiliations')
      .insert({
        person_id: person.id,
        organization_id: org.id,
        relationship: input.relationship,
        title: input.title?.trim() || null,
        is_primary_contact: Boolean(input.isPrimaryContact),
        start_date: input.startDate || null,
      })
      .select('id')
      .single()
    if (error) throw affiliationError(error)
    if (input.isPrimaryContact) await clearOtherPrimaries(supabase, org.id, (created as { id: string }).id)

    revalidateAffiliation({ person_id: person.id, organization_id: org.id })
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not add the link')
  }
}

/**
 * Create a new person and link them to an organization in one step (the
 * "+ Add leader" form and the Add person modal's Create new tab).
 */
export async function createPersonAtOrganization(input: {
  organizationId: string
  first_name: string
  last_name?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
  linkedin_url?: string | null
  relationship: AffiliationRelationship
  isPrimaryContact?: boolean
}): Promise<ContactActionResult<{ personId: string }>> {
  try {
    const memberId = await requireMemberId()
    if (!AFFILIATION_RELATIONSHIPS.includes(input.relationship)) throw new ActionError('Unknown relationship')
    const firstName = text(input.first_name)
    if (!firstName) throw new ActionError('First name is required')

    const supabase = await createClient()
    if ((await contactKind(supabase, input.organizationId)) !== 'organization') {
      throw new ActionError('Organization not found')
    }

    const email = normalizeEmail(input.email)
    await assertEmailsFree(supabase, { email, alternative_emails: [] })
    const title = text(input.title)
    const person = await insertContact(
      supabase,
      {
        kind: 'person',
        first_name: firstName,
        last_name: text(input.last_name),
        email,
        phone: text(input.phone),
        title,
        linkedin_url: url(input.linkedin_url),
      },
      memberId
    )

    const { data: created, error } = await supabase
      .from('affiliations')
      .insert({
        person_id: person.id,
        organization_id: input.organizationId,
        relationship: input.relationship,
        title,
        is_primary_contact: Boolean(input.isPrimaryContact),
      })
      .select('id')
      .single()
    if (error) {
      // Don't leave a stray person behind
      await supabase.from('contacts').delete().eq('id', person.id)
      throw affiliationError(error)
    }
    if (input.isPrimaryContact) {
      await clearOtherPrimaries(supabase, input.organizationId, (created as { id: string }).id)
    }

    revalidatePath('/people')
    revalidateAffiliation({ person_id: person.id, organization_id: input.organizationId })
    return { ok: true, personId: person.id }
  } catch (err) {
    return fail(err, 'Could not add the person')
  }
}

export async function updateAffiliation(
  affiliationId: string,
  input: {
    relationship?: AffiliationRelationship
    title?: string | null
    isPrimaryContact?: boolean
    startDate?: string | null
    endDate?: string | null
    /** End the link today in the organization's time zone (overrides endDate) */
    endedToday?: boolean
  }
): Promise<AffiliationResult> {
  try {
    await requireMemberId()
    const patch: Database['public']['Tables']['affiliations']['Update'] = {}
    if (input.relationship !== undefined) {
      if (!AFFILIATION_RELATIONSHIPS.includes(input.relationship)) throw new ActionError('Unknown relationship')
      patch.relationship = input.relationship
    }
    if (input.title !== undefined) patch.title = input.title?.trim() || null
    if (input.isPrimaryContact !== undefined) patch.is_primary_contact = input.isPrimaryContact
    for (const [key, value] of [
      ['start_date', input.startDate],
      ['end_date', input.endDate],
    ] as const) {
      if (value === undefined) continue
      if (value && !DATE_RE.test(value)) throw new ActionError('Invalid date')
      patch[key] = value || null
    }

    const supabase = await createClient()
    if (input.endedToday) patch.end_date = await orgToday(supabase)
    const { data, error } = await supabase
      .from('affiliations')
      .update(patch)
      .eq('id', affiliationId)
      .select('person_id, organization_id')
      .maybeSingle()
    if (error) throw affiliationError(error)
    const row = data as { person_id: string; organization_id: string } | null
    if (!row) throw new ActionError('Link not found')
    if (input.isPrimaryContact) await clearOtherPrimaries(supabase, row.organization_id, affiliationId)

    revalidateAffiliation(row)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not update the link')
  }
}

/** Mark a current affiliation as former (ended today), or reinstate it. */
export async function setAffiliationEnded(affiliationId: string, ended: boolean): Promise<AffiliationResult> {
  return updateAffiliation(affiliationId, ended ? { endedToday: true } : { endDate: null })
}

export async function removeAffiliation(affiliationId: string): Promise<AffiliationResult> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('affiliations')
      .delete()
      .eq('id', affiliationId)
      .select('person_id, organization_id')
      .maybeSingle()
    if (error) throw new ActionError(error.message)
    const row = data as { person_id: string; organization_id: string } | null
    if (row) revalidateAffiliation(row)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not remove the link')
  }
}
