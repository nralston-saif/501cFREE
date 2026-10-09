import type { ContactKind, NoteLinkEntityType } from '@/lib/supabase/types/database'

// Shapes shared by the notes server loader (components/ContactNotes.tsx) and
// the client composer/timeline. Type-only, so client components can import it.

/** A record a note is (or can be) linked to, shown as a chip. */
export type NoteLinkChip = {
  entityType: NoteLinkEntityType
  entityId: string
  label: string
  /** For contact chips: picks the person or building icon */
  contactKind?: ContactKind
}

export type NoteLinkRef = {
  entity_type: NoteLinkEntityType
  entity_id: string
  is_primary: boolean
}

export type TimelineNote = {
  id: string
  content: string
  note_date: string
  author_id: string | null
  author_name: string | null
  created_at: string
  links: NoteLinkRef[]
  /** Original files filed through the notes inbox */
  attachments: { storage_path: string; file_name: string }[]
}

/** A meeting the contact attended; read-only here, edited on /meetings. */
export type TimelineMeeting = {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  content: string
  /** Other attendees, as contact ids */
  attendee_ids: string[]
}

/** Display label and page for each linked record, keyed by linkKey(). */
export type LinkLabels = Record<string, { label: string; href: string | null }>

export function linkKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`
}

/** Plain text of a note body (HTML or plain), for length checks and previews. */
export function noteText(content: string): string {
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Load a plain-text note into the rich editor: one paragraph per line. */
export function noteToEditorHtml(content: string): string {
  if (content.includes('<')) return content
  const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return content
    .split('\n')
    .map((line) => `<p>${escape(line)}</p>`)
    .join('')
}
