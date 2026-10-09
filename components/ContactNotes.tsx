import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { getOrgSettings } from '@/lib/settings'
import { todayInTimeZone } from '@/lib/utils/dates'
import { meetingDay } from '@/lib/contacts/crm'
import { fetchAll, fetchByKeys } from '@/lib/supabase/fetch-all'
import type { ContactKind, NoteLinkEntityType } from '@/lib/supabase/types/database'
import ContactNotesClient from './ContactNotesClient'
import {
  linkKey,
  type LinkLabels,
  type NoteLinkChip,
  type NoteLinkRef,
  type TimelineMeeting,
  type TimelineNote,
} from './crm/notes/types'

// Notes section for a contact, grant proposal or PRI. Notes are shared by
// the whole team and can be linked to several records (via note_links), so
// a note filed from the notes inbox shows on every record it mentions. A
// contact's timeline also lists the meetings it attended.

type Client = Awaited<ReturnType<typeof createClient>>

function contactHref(kind: ContactKind, id: string): string {
  return kind === 'person' ? `/people/${id}` : `/organizations/${id}`
}

/** The primary chip for a proposal or PRI, plus its applicant/recipient as a
 * pre-attached link so the note also shows on that contact. */
async function recordContext(
  supabase: Client,
  entityType: NoteLinkEntityType,
  entityId: string
): Promise<{ label: string; autoLinks: NoteLinkChip[] }> {
  type ContactRef = { id: string; display_name: string; kind: ContactKind }
  let label = 'This record'
  let contact: ContactRef | null = null
  if (entityType === 'contact') {
    const { data } = await supabase.from('contacts').select('display_name').eq('id', entityId).maybeSingle()
    label = (data as { display_name: string } | null)?.display_name ?? 'This contact'
  } else if (entityType === 'grant_proposal') {
    const { data } = await supabase
      .from('grant_proposals')
      .select('title, applicant:contacts!applicant_contact_id(id, display_name, kind)')
      .eq('id', entityId)
      .maybeSingle()
    const row = data as unknown as { title: string; applicant: ContactRef | null } | null
    label = row?.title ?? 'This proposal'
    contact = row?.applicant ?? null
  } else if (entityType === 'pri') {
    const { data } = await supabase
      .from('pris')
      .select('recipient:contacts!recipient_contact_id(id, display_name, kind)')
      .eq('id', entityId)
      .maybeSingle()
    contact = (data as unknown as { recipient: ContactRef | null } | null)?.recipient ?? null
    label = 'This PRI'
  } else if (entityType === 'meeting') {
    const { data } = await supabase.from('meetings').select('title').eq('id', entityId).maybeSingle()
    label = (data as { title: string } | null)?.title ?? 'This meeting'
  }

  const autoLinks: NoteLinkChip[] = []
  if (contact) {
    autoLinks.push({ entityType: 'contact', entityId: contact.id, label: contact.display_name, contactKind: contact.kind })
    if (entityType === 'pri') label = `PRI: ${contact.display_name}`
  }
  return { label, autoLinks }
}

/** Labels and links for every record the timeline's badges mention. */
async function loadLinkLabels(
  supabase: Client,
  refs: { entity_type: NoteLinkEntityType; entity_id: string }[]
): Promise<LinkLabels> {
  const ids: Record<NoteLinkEntityType, Set<string>> = {
    contact: new Set(),
    meeting: new Set(),
    grant_proposal: new Set(),
    pri: new Set(),
  }
  for (const r of refs) ids[r.entity_type]?.add(r.entity_id)
  const list = (t: NoteLinkEntityType) => [...ids[t]]

  // Chunked lookups: a busy timeline can mention more records than one
  // .in() list should carry
  const [contacts, meetings, proposals, pris] = await Promise.all([
    fetchByKeys<{ id: string; display_name: string; kind: ContactKind }, string>(list('contact'), (chunk) =>
      supabase.from('contacts').select('id, display_name, kind').in('id', chunk)
    ),
    fetchByKeys<{ id: string; title: string }, string>(list('meeting'), (chunk) =>
      supabase.from('meetings').select('id, title').in('id', chunk)
    ),
    fetchByKeys<{ id: string; title: string }, string>(list('grant_proposal'), (chunk) =>
      supabase.from('grant_proposals').select('id, title').in('id', chunk)
    ),
    fetchByKeys<{ id: string; recipient: { display_name: string } | null }, string>(list('pri'), (chunk) =>
      supabase.from('pris').select('id, recipient:contacts!recipient_contact_id(display_name)').in('id', chunk)
    ),
  ])

  const labels: LinkLabels = {}
  for (const c of contacts) {
    labels[linkKey('contact', c.id)] = { label: c.display_name, href: contactHref(c.kind, c.id) }
  }
  for (const m of meetings) {
    labels[linkKey('meeting', m.id)] = { label: `Meeting: ${m.title}`, href: `/meetings?id=${m.id}` }
  }
  for (const p of proposals) {
    labels[linkKey('grant_proposal', p.id)] = { label: `Proposal: ${p.title}`, href: `/grants-out/proposals/${p.id}` }
  }
  for (const p of pris) {
    const who = p.recipient?.display_name
    labels[linkKey('pri', p.id)] = { label: who ? `PRI: ${who}` : 'PRI', href: `/pris/${p.id}` }
  }
  return labels
}

type ContactNotesProps = {
  entityType: NoteLinkEntityType
  entityId: string
  /** Primary chip label; looked up when left out */
  label?: string
  /** Pre-attached links; for proposals and PRIs defaults to the applicant/recipient */
  autoLinks?: NoteLinkChip[]
  suggestedLinks?: NoteLinkChip[]
  contactKind?: ContactKind
  title?: string
}

// The timeline streams in behind a Suspense boundary, so its queries never
// hold up the detail page around it.
export default function ContactNotes(props: ContactNotesProps) {
  return (
    <Suspense fallback={<NotesSkeleton title={props.title} />}>
      <LoadedContactNotes {...props} />
    </Suspense>
  )
}

/** Placeholder card while the notes load */
function NotesSkeleton({ title = 'Notes' }: { title?: string }) {
  return (
    <div className="card p-6" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
      <div className="h-5 w-24 bg-gray-200 rounded animate-pulse mb-4" />
      <div className="h-20 bg-gray-200 rounded animate-pulse mb-4" />
      <div className="space-y-2">
        <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
      </div>
    </div>
  )
}

async function LoadedContactNotes({
  entityType,
  entityId,
  label,
  autoLinks,
  suggestedLinks = [],
  contactKind,
  title,
}: ContactNotesProps) {
  const supabase = await createClient()
  type NoteRow = {
    id: string
    content: string
    note_date: string
    author_id: string | null
    created_at: string
    author: { full_name: string } | null
    links: NoteLinkRef[] | null
    files: { storage_path: string; file_name: string }[] | null
  }
  type MeetingRow = {
    id: string
    title: string
    meeting_date: string
    content: string | null
    attendees: { contact_id: string }[] | null
  }

  // One wave: each note comes with its author, links and files, and each
  // attended meeting with its attendees (embedded, so no .in() lists).
  const [{ memberId }, { timezone }, context, linkRows, attendedRows] = await Promise.all([
    getAuthState(),
    getOrgSettings(),
    label && autoLinks ? Promise.resolve({ label, autoLinks }) : recordContext(supabase, entityType, entityId),
    fetchAll<{ note: NoteRow | null }>(() =>
      supabase
        .from('note_links')
        .select(
          'id, note:notes!note_id(id, content, note_date, author_id, created_at, author:team_members!author_id(full_name), links:note_links!note_id(entity_type, entity_id, is_primary), files:note_attachments!note_id(storage_path, file_name))'
        )
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('id')
    ),
    entityType === 'contact'
      ? fetchAll<{ meeting: MeetingRow | null }>(() =>
          supabase
            .from('meeting_attendees')
            .select(
              'id, meeting:meetings!meeting_id(id, title, meeting_date, content, attendees:meeting_attendees!meeting_id(contact_id))'
            )
            .eq('contact_id', entityId)
            .order('id')
        )
      : Promise.resolve([] as { meeting: MeetingRow | null }[]),
  ])

  // Distinct notes, newest first (note date, then entry time)
  const noteRows = [...new Map(linkRows.flatMap((l) => (l.note ? [[l.note.id, l.note] as const] : []))).values()].sort(
    (a, b) => b.note_date.localeCompare(a.note_date) || b.created_at.localeCompare(a.created_at)
  )
  const meetingRows = [...new Map(attendedRows.flatMap((r) => (r.meeting ? [[r.meeting.id, r.meeting] as const] : []))).values()]
  const allLinks = noteRows.flatMap((n) => n.links ?? [])
  const attendeeIds = meetingRows.flatMap((m) => (m.attendees ?? []).map((a) => a.contact_id))

  const linkLabels = await loadLinkLabels(supabase, [
    ...allLinks,
    ...attendeeIds.map((id) => ({ entity_type: 'contact' as const, entity_id: id })),
  ])

  const notes: TimelineNote[] = noteRows.map((n) => ({
    id: n.id,
    content: n.content,
    note_date: n.note_date,
    author_id: n.author_id,
    created_at: n.created_at,
    author_name: n.author?.full_name ?? null,
    links: (n.links ?? []).map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id, is_primary: l.is_primary })),
    attachments: (n.files ?? []).map((f) => ({ storage_path: f.storage_path, file_name: f.file_name })),
  }))

  const meetings: TimelineMeeting[] = meetingRows.map((m) => ({
    id: m.id,
    title: m.title,
    date: meetingDay(m.meeting_date, timezone),
    content: m.content ?? '',
    attendee_ids: (m.attendees ?? []).map((a) => a.contact_id),
  }))

  const primary: NoteLinkChip = {
    entityType,
    entityId,
    label: context.label,
    contactKind: entityType === 'contact' ? contactKind : undefined,
  }

  return (
    <ContactNotesClient
      primary={primary}
      autoLinks={context.autoLinks}
      suggestedLinks={suggestedLinks}
      notes={notes}
      meetings={meetings}
      linkLabels={linkLabels}
      viewerMemberId={memberId}
      today={todayInTimeZone(timezone)}
      title={title}
    />
  )
}
