'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { escapeLike } from '@/lib/contacts/lookup'
import { sanitizeRichText } from '@/lib/security/sanitize-html'
import { requireMemberId, ActionError, actionErrorMessage } from './helpers'
import type { ContactKind, Meeting } from '@/lib/supabase/types/database'

/**
 * Meetings: shared notes the team edits together (/meetings). The body is
 * live-edited through Liveblocks when configured and autosaved here as HTML;
 * attendees are contacts (meeting_attendees), which also lists the meeting on
 * each attendee's contact page. Every action returns a Result so the client
 * can show the real error message.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export type MeetingRow = Pick<Meeting, 'id' | 'title' | 'meeting_date' | 'content' | 'created_by' | 'updated_at'>

export type AttendeeContact = { id: string; display_name: string; kind: ContactKind }

const MEETING_COLUMNS = 'id, title, meeting_date, content, created_by, updated_at'
const MEETING_LIST_LIMIT = 200
const CONTACT_SEARCH_LIMIT = 20

function errorMessage(err: unknown, fallback: string): string {
  return actionErrorMessage(err, fallback)
}

/**
 * The newest meetings first (capped); shared by the page's first render and
 * the client's refetch. `includeId` (a deep link or the open meeting) is
 * appended when it's older than the cap, so it still opens.
 */
export async function listMeetings(includeId?: string): Promise<Result<{ meetings: MeetingRow[] }>> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const [{ data, error }, extra] = await Promise.all([
      supabase
        .from('meetings')
        .select(MEETING_COLUMNS)
        .order('meeting_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MEETING_LIST_LIMIT),
      includeId
        ? supabase.from('meetings').select(MEETING_COLUMNS).eq('id', includeId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (error) throw new ActionError(error.message)
    const meetings = (data ?? []) as MeetingRow[]
    const included = extra.data as MeetingRow | null
    if (included && !meetings.some((m) => m.id === included.id)) meetings.push(included)
    return { ok: true, meetings }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't load meetings") }
  }
}

/** `meetingDate` is a YYYY-MM-DD calendar date. */
export async function createMeeting(title: string, meetingDate: string): Promise<Result<{ meeting: MeetingRow }>> {
  try {
    const memberId = await requireMemberId()
    const t = title.trim()
    if (!t) throw new ActionError('Title is required')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) throw new ActionError('Invalid date')

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('meetings')
      .insert({ title: t, meeting_date: meetingDate, created_by: memberId })
      .select(MEETING_COLUMNS)
      .single()
    if (error || !data) throw new ActionError(error?.message ?? "Couldn't create the meeting")
    revalidatePath('/meetings')
    return { ok: true, meeting: data as MeetingRow }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't create the meeting") }
  }
}

export async function updateMeetingTitle(meetingId: string, title: string): Promise<Result> {
  try {
    await requireMemberId()
    const t = title.trim()
    if (!t) throw new ActionError('Title is required')
    const supabase = await createClient()
    const { error } = await supabase.from('meetings').update({ title: t }).eq('id', meetingId)
    if (error) throw new ActionError(error.message)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't rename the meeting") }
  }
}

/** `meetingDate` is a YYYY-MM-DD calendar date. */
export async function updateMeetingDate(meetingId: string, meetingDate: string): Promise<Result> {
  try {
    await requireMemberId()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) throw new ActionError('Invalid date')
    const supabase = await createClient()
    const { error } = await supabase.from('meetings').update({ meeting_date: meetingDate }).eq('id', meetingId)
    if (error) throw new ActionError(error.message)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't change the date") }
  }
}

/** Autosave target for the editor; content is the editor's HTML (sanitized before storing). */
export async function saveMeetingContent(meetingId: string, content: string): Promise<Result> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({ content: sanitizeRichText(content) })
      .eq('id', meetingId)
    if (error) throw new ActionError(error.message)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't save the notes") }
  }
}

/** Only the meeting's creator or an admin may delete it. */
export async function deleteMeeting(meetingId: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const { isAdmin } = await getAuthState()
    const supabase = await createClient()
    const { data: meeting } = await supabase.from('meetings').select('id, created_by').eq('id', meetingId).maybeSingle()
    if (!meeting) throw new ActionError('Meeting not found')
    if (!isAdmin && meeting.created_by !== memberId) {
      throw new ActionError('Only the person who started this meeting or an admin can delete it')
    }
    // Attendees cascade; linked notes' meeting links go via trigger
    const { error } = await supabase.from('meetings').delete().eq('id', meetingId)
    if (error) throw new ActionError(error.message)
    revalidatePath('/meetings')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't delete the meeting") }
  }
}

export async function listAttendees(meetingId: string): Promise<Result<{ attendees: AttendeeContact[] }>> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('meeting_attendees')
      .select('contact:contacts!contact_id(id, display_name, kind)')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true })
    if (error) throw new ActionError(error.message)
    const rows = (data ?? []) as unknown as { contact: AttendeeContact | null }[]
    return { ok: true, attendees: rows.flatMap((r) => (r.contact ? [r.contact] : [])) }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't load attendees") }
  }
}

export async function addAttendee(meetingId: string, contactId: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    // Re-adding an existing attendee is a no-op
    const { error } = await supabase
      .from('meeting_attendees')
      .upsert(
        { meeting_id: meetingId, contact_id: contactId, created_by: memberId },
        { onConflict: 'meeting_id,contact_id', ignoreDuplicates: true }
      )
    if (error) throw new ActionError(error.message)
    revalidatePath(`/contacts/${contactId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't add the attendee") }
  }
}

export async function removeAttendee(meetingId: string, contactId: string): Promise<Result> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { error } = await supabase
      .from('meeting_attendees')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('contact_id', contactId)
    if (error) throw new ActionError(error.message)
    revalidatePath(`/contacts/${contactId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't remove the attendee") }
  }
}

/**
 * Search-as-you-type for the attendee picker (active contacts only); a blank
 * query lists the first contacts A–Z.
 */
export async function searchContactsForAttendees(query: string): Promise<Result<{ contacts: AttendeeContact[] }>> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    let q = supabase
      .from('contacts')
      .select('id, display_name, kind')
      .eq('is_active', true)
      .order('display_name', { ascending: true })
      .limit(CONTACT_SEARCH_LIMIT)
    const term = query.trim()
    if (term) q = q.ilike('display_name', `%${escapeLike(term)}%`)
    const { data, error } = await q
    if (error) throw new ActionError(error.message)
    return { ok: true, contacts: (data ?? []) as AttendeeContact[] }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't search contacts") }
  }
}
