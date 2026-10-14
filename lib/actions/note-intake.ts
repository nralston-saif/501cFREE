'use server'

import { revalidatePath } from 'next/cache'
import {
  CONTACT_ROLES,
  ORG_RELATIONSHIPS,
  DEMO_STAGE_MAX_BYTES,
  checkFile,
  storagePathFor,
  isReviewDraft,
  renderNoteHtml,
  type ContactKind,
  type ContactToCreate,
  type CreatedContact,
  type LinkEntityType,
  type ReviewDraft,
} from '@/lib/note-intake-core'
import type { Json } from '@/lib/supabase/types/database'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { sanitizeRichText } from '@/lib/security/sanitize-html'
import { getOrgSettings } from '@/lib/settings'
import { todayInTimeZone } from '@/lib/utils/dates'
import { findContactIdByEmail, findOrganizationIdByName } from '@/lib/contacts/lookup'
import { nameFieldsFor, normalizeEmail } from '@/lib/contacts/names'
import { listLinkableRecords, searchContacts } from '@/lib/note-intake/context'
import { ActionError, requireMemberId, actionErrorMessage } from './helpers'

// Notes inbox: dropped files → Claude's proposal → a person reviews and files
// notes onto contacts, grant proposals and PRIs. Every write runs under the
// viewer's session; RLS keeps unfiled intakes private to their uploader.

const NOTE_FILES_BUCKET = 'note-files'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const LINK_TYPES: LinkEntityType[] = ['contact', 'grant_proposal', 'pri']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: actionErrorMessage(err, fallback) }
}

/** Start a drop; the browser then uploads the files under it. */
export async function createNoteIntake(): Promise<Result<{ id: string }>> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('note_intakes')
      .insert({ created_by: memberId })
      .select('id')
      .single()
    if (error || !data) throw new ActionError(`Could not start upload: ${error?.message ?? 'no row'}`)
    return { ok: true, id: data.id }
  } catch (err) {
    return fail(err, 'Could not start upload')
  }
}

/**
 * Demo mode only: record and store one dropped file under an intake. Live
 * installs upload straight to the note-files bucket from the browser (no
 * body-size cap); demo mode has no real storage to upload to.
 */
export async function stageNoteIntakeFile(intakeId: string, formData: FormData): Promise<Result> {
  try {
    await requireMemberId()
    if (!isDemoMode()) throw new ActionError('Upload files directly to storage')
    const file = formData.get('file')
    if (!(file instanceof File)) throw new ActionError('No file provided')
    const check = checkFile(file.name, file.size)
    if (!check.ok) throw new ActionError(`${file.name}: ${check.reason}`)
    if (file.size > DEMO_STAGE_MAX_BYTES) throw new ActionError(`${file.name}: the demo takes files up to 8 MB.`)

    const supabase = await createClient()
    const { data: intake } = await supabase.from('note_intakes').select('id, status').eq('id', intakeId).maybeSingle()
    if (!intake) throw new ActionError('Upload not found')
    if (intake.status === 'filed') throw new ActionError('These notes are already filed')

    const path = storagePathFor(intakeId, file.name, crypto.randomUUID())
    const { error: uploadError } = await supabase.storage
      .from(NOTE_FILES_BUCKET)
      .upload(path, file, { contentType: check.mime, upsert: false })
    if (uploadError) throw new ActionError(`Couldn't upload ${file.name}: ${uploadError.message}`)
    const { error: rowError } = await supabase.from('note_intake_files').insert({
      intake_id: intakeId,
      storage_path: path,
      file_name: file.name,
      mime_type: check.mime,
      size_bytes: file.size,
    })
    if (rowError) throw new ActionError(`Couldn't record ${file.name}: ${rowError.message}`)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Upload failed')
  }
}

export type ReviewedNote = {
  title: string
  note_date: string | null
  summary: string
  key_points: string[]
  follow_ups: string[]
  transcript: string
  file_indexes: number[]
  links: { entity_type: LinkEntityType; entity_id: string }[]
}

/** Write the reviewed notes, their links and the original files. */
export async function fileNoteIntake(intakeId: string, notes: ReviewedNote[]): Promise<Result<{ noteIds: string[] }>> {
  const createdNoteIds: string[] = []
  const supabase = await createClient()
  try {
    const memberId = await requireMemberId()
    if (notes.length === 0) throw new ActionError('Nothing to file')

    const { data: intake } = await supabase
      .from('note_intakes')
      .select('id, status')
      .eq('id', intakeId)
      .maybeSingle()
    if (!intake) throw new ActionError('Upload not found')
    if (intake.status === 'filed') throw new ActionError('These notes are already filed')

    const { data: files } = await supabase
      .from('note_intake_files')
      .select('storage_path, file_name, mime_type, size_bytes')
      .eq('intake_id', intakeId)
      .order('created_at', { ascending: true })
    const fileList = files ?? []

    const today = todayInTimeZone((await getOrgSettings(supabase)).timezone)

    for (const note of notes) {
      // renderNoteHtml escapes the AI/reviewer text; sanitize anyway so every
      // stored note body goes through the same allowlist
      const content = sanitizeRichText(renderNoteHtml(note))
      if (!content) throw new ActionError('A note is empty. Remove it or add content.')
      const links = note.links.filter((l) => LINK_TYPES.includes(l.entity_type) && UUID_RE.test(l.entity_id))
      if (links.length === 0) throw new ActionError(`"${note.title || 'Untitled note'}" isn't linked to anything yet.`)

      const { data: row, error: noteError } = await supabase
        .from('notes')
        .insert({
          content,
          author_id: memberId,
          note_date: note.note_date && DATE_RE.test(note.note_date) ? note.note_date : today,
        })
        .select('id')
        .single()
      if (noteError || !row) throw new ActionError(`Could not save a note: ${noteError?.message ?? 'no row'}`)
      createdNoteIds.push(row.id)

      const seen = new Set<string>()
      const linkRows = links
        .filter((l) => {
          const key = `${l.entity_type}:${l.entity_id}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((l, i) => ({ note_id: row.id, entity_type: l.entity_type, entity_id: l.entity_id, is_primary: i === 0 }))
      const { error: linkError } = await supabase.from('note_links').insert(linkRows)
      if (linkError) throw new ActionError(`Could not link a note: ${linkError.message}`)

      // The filed note points at the same storage objects as the intake
      const attachmentRows = [...new Set(note.file_indexes)]
        .map((i) => fileList[i])
        .filter((f): f is NonNullable<typeof f> => Boolean(f))
        .map((f) => ({
          note_id: row.id,
          storage_path: f.storage_path,
          file_name: f.file_name,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
          uploaded_by: memberId,
        }))
      if (attachmentRows.length) {
        const { error: attachError } = await supabase.from('note_attachments').insert(attachmentRows)
        if (attachError) throw new ActionError(`Could not attach the original files: ${attachError.message}`)
      }
    }

    const { error: doneError } = await supabase
      .from('note_intakes')
      .update({ status: 'filed', note_ids: createdNoteIds, filed_at: new Date().toISOString() })
      .eq('id', intakeId)
    if (doneError) throw new ActionError(`Notes saved, but the inbox didn't update: ${doneError.message}`)

    revalidatePath('/notes-inbox')
    return { ok: true, noteIds: createdNoteIds }
  } catch (err) {
    // All or nothing: links and attachments cascade with the notes
    if (createdNoteIds.length && !(err instanceof ActionError && err.message.startsWith('Notes saved'))) {
      await supabase.from('notes').delete().in('id', createdNoteIds)
    }
    return fail(err, 'Could not file these notes')
  }
}

/** Autosave the reviewer's edits (Claude's original proposal is kept as-is). */
export async function saveNoteIntakeDraft(intakeId: string, draft: ReviewDraft): Promise<Result> {
  try {
    await requireMemberId()
    if (!isReviewDraft(draft)) throw new ActionError('Invalid draft')
    const supabase = await createClient()
    const { error } = await supabase
      .from('note_intakes')
      .update({ draft: draft as unknown as Json })
      .eq('id', intakeId)
      .eq('status', 'ready')
    if (error) throw new ActionError(`Couldn't save your edits: ${error.message}`)
    return { ok: true }
  } catch (err) {
    return fail(err, "Couldn't save your edits")
  }
}

/** Delete an unfiled drop and its uploaded files. */
export async function discardNoteIntake(intakeId: string): Promise<Result> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data: intake } = await supabase
      .from('note_intakes')
      .select('id, status')
      .eq('id', intakeId)
      .maybeSingle()
    if (!intake) throw new ActionError('Upload not found')
    if (intake.status === 'filed') throw new ActionError('Filed notes can’t be discarded here. Delete the notes instead.')

    const { data: files } = await supabase.from('note_intake_files').select('storage_path').eq('intake_id', intakeId)
    const paths = (files ?? []).map((f) => f.storage_path)
    if (paths.length) await supabase.storage.from(NOTE_FILES_BUCKET).remove(paths)

    const { error } = await supabase.from('note_intakes').delete().eq('id', intakeId)
    if (error) throw new ActionError(`Could not discard: ${error.message}`)
    revalidatePath('/notes-inbox')
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not discard')
  }
}

export type LinkTarget = {
  entity_type: LinkEntityType
  entity_id: string
  label: string
  detail: string
  contact_kind?: ContactKind
}

/** Manual "add link" search on the review screen: contacts, grant proposals, PRIs. */
export async function searchLinkTargets(query: string): Promise<Result<{ targets: LinkTarget[] }>> {
  try {
    await requireMemberId()
    const q = query.trim()
    if (q.length < 2) return { ok: true, targets: [] }
    const supabase = await createClient()
    const [contacts, records] = await Promise.all([
      searchContacts(supabase, q),
      listLinkableRecords(supabase).catch(() => []),
    ])
    const needle = q.toLowerCase()
    return {
      ok: true,
      targets: [
        ...contacts.map((c) => ({
          entity_type: 'contact' as const,
          entity_id: c.id,
          label: c.name,
          detail: c.detail,
          contact_kind: c.kind,
        })),
        ...records
          .filter((r) => `${r.label} ${r.detail}`.toLowerCase().includes(needle))
          .slice(0, 10)
          .map((r) => ({ entity_type: r.type, entity_id: r.id, label: r.label, detail: r.detail })),
      ],
    }
  } catch (err) {
    return fail(err, 'Search failed')
  }
}

// ---------------------------------------------------------------------------
// New contacts proposed on the review screen
// ---------------------------------------------------------------------------

export type CreateNoteContactsResult =
  | { ok: true; created: Record<string, CreatedContact> }
  /** `created` holds whatever succeeded before the failure, so a retry won't duplicate it */
  | { ok: false; error: string; created: Record<string, CreatedContact> }

const ROLE_VALUES = CONTACT_ROLES.map((r) => r.value)
const RELATIONSHIP_VALUES = ORG_RELATIONSHIPS.map((r) => r.value)

/**
 * Create the contacts the reviewer kept: organizations first, then people,
 * each with an affiliation to their organization. An existing person with the
 * same email, or an existing organization with the same name, is reused
 * instead of duplicated (and left unchanged).
 */
export async function createContactsFromNote(items: ContactToCreate[]): Promise<CreateNoteContactsResult> {
  const created: Record<string, CreatedContact> = {}
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    const ordered = [...items.filter((i) => i.kind === 'organization'), ...items.filter((i) => i.kind === 'person')]

    for (const item of ordered) {
      const name = item.name.trim()
      if (!name) throw new ActionError('A new contact has no name')
      if (!ROLE_VALUES.includes(item.role)) throw new ActionError(`Unknown relationship for ${name}`)
      const email = item.kind === 'person' ? normalizeEmail(item.email) : null

      let id =
        item.kind === 'organization'
          ? await findOrganizationIdByName(supabase, name)
          : await findContactIdByEmail(supabase, email)

      if (!id) {
        const { data, error } = await supabase
          .from('contacts')
          .insert({
            kind: item.kind,
            ...nameFieldsFor(item.kind, name),
            email,
            // 'contact' sets no flag: a general contact
            is_donor: item.role === 'donor',
            is_grantee: item.role === 'grantee',
            is_funder: item.role === 'funder',
            is_vendor: item.role === 'vendor',
            is_lead: item.role === 'lead',
            created_by: memberId,
          })
          .select('id')
          .single()
        if (error || !data) throw new ActionError(`Could not create ${name}: ${error?.message ?? 'no row'}`)
        id = data.id
      }
      created[item.key] = { id, label: name, kind: item.kind }

      // The person's role at their organization
      if (item.kind === 'person' && item.org) {
        const organizationId = item.org.type === 'existing' ? item.org.id : created[item.org.key]?.id
        if (organizationId) {
          const { data: existing } = await supabase
            .from('affiliations')
            .select('id')
            .eq('person_id', id)
            .eq('organization_id', organizationId)
            .limit(1)
            .maybeSingle()
          if (!existing) {
            const relationship =
              item.relationship && RELATIONSHIP_VALUES.includes(item.relationship) ? item.relationship : 'contact'
            const { error } = await supabase.from('affiliations').insert({
              person_id: id,
              organization_id: organizationId,
              relationship,
              title: item.title,
            })
            if (error) throw new ActionError(`Created ${name}, but couldn't record their role: ${error.message}`)
          }
        }
      }
    }

    revalidatePath('/contacts')
    return { ok: true, created }
  } catch (err) {
    return {
      ok: false,
      error: actionErrorMessage(err, 'Could not create contacts'),
      created,
    }
  }
}
