'use server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberId, ActionError, runAction, type ActionResult, actionErrorMessage } from './helpers'
import { sanitizeRichText } from '@/lib/security/sanitize-html'
import { noteText } from '@/components/crm/notes/types'
import type { NoteLinkEntityType } from '@/lib/supabase/types/database'

// Notes timeline actions used by ContactNotes (contacts, grant proposals,
// PRIs). Notes are shared by the whole team; only the author edits or
// deletes their own. A note has one primary link (the record it was written
// on) plus any number of other links, so it shows on each linked record.
// Callers refresh the page after a write.

export type NoteActionResult = { ok: true } | { ok: false; error: string }

export type NoteLinkTarget = { entityType: NoteLinkEntityType; entityId: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const ENTITY_TYPES: NoteLinkEntityType[] = ['contact', 'meeting', 'grant_proposal', 'pri']

/** Sanitized body, or an error when nothing readable is left. */
function cleanContent(raw: string): string {
  const content = sanitizeRichText(raw.trim())
  if (!noteText(content)) throw new ActionError('The note is empty')
  return content
}

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: actionErrorMessage(err, fallback) }
}

export async function createNote(input: {
  entityType: NoteLinkEntityType
  entityId: string
  content: string
  noteDate: string
  /** Other records to link the note to */
  links?: NoteLinkTarget[]
}): Promise<{ ok: true; noteId: string } | { ok: false; error: string }> {
  try {
    const memberId = await requireMemberId()
    if (!ENTITY_TYPES.includes(input.entityType)) throw new ActionError('Unknown record type')
    const content = cleanContent(input.content)
    if (input.noteDate && !DATE_RE.test(input.noteDate)) throw new ActionError('Invalid date')

    const supabase = await createClient()
    const { data: note, error } = await supabase
      .from('notes')
      .insert({ content, note_date: input.noteDate || undefined, author_id: memberId })
      .select('id')
      .single()
    if (error) throw new ActionError(error.message)
    const noteId = (note as { id: string }).id

    const primaryKey = `${input.entityType}:${input.entityId}`
    const others = dedupeLinks(input.links ?? []).filter((l) => `${l.entityType}:${l.entityId}` !== primaryKey)
    const { error: linkError } = await supabase.from('note_links').insert([
      { note_id: noteId, entity_type: input.entityType, entity_id: input.entityId, is_primary: true },
      ...others.map((l) => ({ note_id: noteId, entity_type: l.entityType, entity_id: l.entityId, is_primary: false })),
    ])
    if (linkError) {
      // Don't leave an orphan note nobody can find
      await supabase.from('notes').delete().eq('id', noteId)
      throw new ActionError(linkError.message)
    }
    return { ok: true, noteId }
  } catch (err) {
    return fail(err, 'Could not save note')
  }
}

function dedupeLinks(links: NoteLinkTarget[]): NoteLinkTarget[] {
  const seen = new Set<string>()
  return links.filter((l) => {
    if (!ENTITY_TYPES.includes(l.entityType) || !l.entityId) return false
    const key = `${l.entityType}:${l.entityId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Update the author's own note (RLS lets any member write, so check here). */
async function assertAuthor(noteId: string, memberId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('notes').select('author_id').eq('id', noteId).maybeSingle()
  if (!data) throw new ActionError('Note not found')
  if ((data as { author_id: string | null }).author_id !== memberId) {
    throw new ActionError('Only the author can change this note')
  }
  return supabase
}

/** Update the author's own note: content and/or date. */
export async function updateNote(
  noteId: string,
  fields: { content?: string; noteDate?: string }
): Promise<NoteActionResult> {
  try {
    const memberId = await requireMemberId()
    const patch: { content?: string; note_date?: string } = {}
    if (fields.content !== undefined) {
      patch.content = cleanContent(fields.content)
    }
    if (fields.noteDate !== undefined) {
      if (!DATE_RE.test(fields.noteDate)) throw new ActionError('Invalid date')
      patch.note_date = fields.noteDate
    }
    if (Object.keys(patch).length === 0) return { ok: true }
    const supabase = await assertAuthor(noteId, memberId)
    const { error } = await supabase.from('notes').update(patch).eq('id', noteId)
    if (error) throw new ActionError(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not update note')
  }
}

/**
 * Replace a note's secondary links with `links`. Primary links (the record
 * the note was written on) are never touched.
 */
export async function setNoteLinks(noteId: string, links: NoteLinkTarget[]): Promise<NoteActionResult> {
  try {
    const memberId = await requireMemberId()
    const supabase = await assertAuthor(noteId, memberId)
    const { data, error: readError } = await supabase
      .from('note_links')
      .select('id, entity_type, entity_id, is_primary')
      .eq('note_id', noteId)
    if (readError) throw new ActionError(readError.message)
    const existing = (data ?? []) as { id: string; entity_type: string; entity_id: string; is_primary: boolean }[]
    const primaryKeys = new Set(existing.filter((l) => l.is_primary).map((l) => `${l.entity_type}:${l.entity_id}`))
    const wanted = dedupeLinks(links).filter((l) => !primaryKeys.has(`${l.entityType}:${l.entityId}`))
    const wantedKeys = new Set(wanted.map((l) => `${l.entityType}:${l.entityId}`))
    const secondary = existing.filter((l) => !l.is_primary)
    const haveKeys = new Set(secondary.map((l) => `${l.entity_type}:${l.entity_id}`))

    // Add missing links first, then drop extras, so a failed insert never
    // leaves the note with fewer links than before
    const toAdd = wanted.filter((l) => !haveKeys.has(`${l.entityType}:${l.entityId}`))
    if (toAdd.length > 0) {
      const { error } = await supabase.from('note_links').insert(
        toAdd.map((l) => ({ note_id: noteId, entity_type: l.entityType, entity_id: l.entityId, is_primary: false }))
      )
      if (error) throw new ActionError(error.message)
    }
    const toRemove = secondary.filter((l) => !wantedKeys.has(`${l.entity_type}:${l.entity_id}`)).map((l) => l.id)
    if (toRemove.length > 0) {
      const { error } = await supabase.from('note_links').delete().in('id', toRemove)
      if (error) throw new ActionError(error.message)
    }
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not update the note\'s links')
  }
}

export async function deleteNote(noteId: string): Promise<NoteActionResult> {
  try {
    const memberId = await requireMemberId()
    const supabase = await assertAuthor(noteId, memberId)
    const { error } = await supabase.from('notes').delete().eq('id', noteId)
    if (error) throw new ActionError(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not delete note')
  }
}

/** Short-lived link to a file filed with a note (bucket note-files). */
export async function noteFileUrl(storagePath: string): Promise<ActionResult<string | null>> {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()
    const { data } = await supabase.storage.from('note-files').createSignedUrl(storagePath, 60 * 10)
    return data?.signedUrl ?? null
  })
}
