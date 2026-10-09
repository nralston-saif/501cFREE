'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import DOMPurify from 'dompurify'
import type { NoteLinkEntityType } from '@/lib/supabase/types/database'
import { linkKey, noteText, type LinkLabels, type TimelineMeeting, type TimelineNote } from './types'

// Read side of the notes section: notes and attended meetings grouped by
// date, newest first. Long entries collapse behind "Show more".

type TimelineItem =
  | { kind: 'note'; date: string; note: TimelineNote }
  | { kind: 'meeting'; date: string; meeting: TimelineMeeting }

const COLLAPSE_CHARS = 800

const LINK_BADGE_STYLES: Record<NoteLinkEntityType, string> = {
  contact: 'bg-purple-100 text-purple-700',
  meeting: 'bg-amber-100 text-amber-700',
  grant_proposal: 'bg-blue-100 text-blue-700',
  pri: 'bg-green-100 text-green-700',
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function LinkBadge({ type, id, linkLabels }: { type: NoteLinkEntityType; id: string; linkLabels: LinkLabels }) {
  const info = linkLabels[linkKey(type, id)]
  if (!info) return null
  const className = `inline-block text-xs font-medium px-2 py-0.5 rounded ${LINK_BADGE_STYLES[type]}`
  const label = type === 'contact' ? `re: ${info.label}` : info.label
  return info.href ? (
    <Link href={info.href} className={`${className} hover:underline`}>
      {label}
    </Link>
  ) : (
    <span className={className}>{label}</span>
  )
}

// DOMPurify needs a browser DOM, so rich notes render as plain text on the
// server and on the first client render, then as sanitized HTML once mounted
// (same output on both sides, so no hydration mismatch).
const noopSubscribe = () => () => {}
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

function NoteBody({ content, fade }: { content: string; fade: string }) {
  const [expanded, setExpanded] = useState(false)
  const isClient = useIsClient()
  const collapsible = noteText(content).length > COLLAPSE_CHARS
  return (
    <>
      <div className={collapsible && !expanded ? 'max-h-40 overflow-hidden relative' : undefined}>
        {content.includes('<') && isClient ? (
          <div
            className="note-content prose prose-sm max-w-none text-gray-700 break-words"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
          />
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
            {content.includes('<') ? noteText(content) : content}
          </p>
        )}
        {collapsible && !expanded && (
          <div className={`absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t ${fade} to-transparent`} />
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

function NoteCard({
  note,
  entityType,
  entityId,
  linkLabels,
  canEdit,
  onEdit,
  onDelete,
  onOpenFile,
}: {
  note: TimelineNote
  entityType: NoteLinkEntityType
  entityId: string
  linkLabels: LinkLabels
  canEdit: boolean
  onEdit: (note: TimelineNote) => void
  onDelete: (note: TimelineNote) => void
  onOpenFile: (path: string) => void
}) {
  const otherLinks = note.links.filter((l) => !(l.entity_type === entityType && l.entity_id === entityId))
  return (
    <div id={`note-${note.id}`} className="bg-gray-50 rounded-lg p-4 border border-gray-100 scroll-mt-24 transition-shadow">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {note.author_name && (
              <>
                <span className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-medium">{note.author_name.charAt(0).toUpperCase()}</span>
                </span>
                <span className="text-sm font-medium text-gray-900">{note.author_name}</span>
              </>
            )}
            {otherLinks.map((l) => (
              <LinkBadge key={linkKey(l.entity_type, l.entity_id)} type={l.entity_type} id={l.entity_id} linkLabels={linkLabels} />
            ))}
          </div>
          <NoteBody content={note.content} fade="from-gray-50" />
          {note.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {note.attachments.map((a) => (
                <button
                  key={a.storage_path}
                  type="button"
                  onClick={() => onOpenFile(a.storage_path)}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {a.file_name}
                </button>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => onEdit(note)}
              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
              title="Edit note"
              aria-label="Edit note"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onDelete(note)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
              title="Delete note"
              aria-label="Delete note"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MeetingCard({
  meeting,
  entityId,
  linkLabels,
}: {
  meeting: TimelineMeeting
  entityId: string
  linkLabels: LinkLabels
}) {
  const others = meeting.attendee_ids.filter((id) => id !== entityId)
  return (
    <div id={`meeting-${meeting.id}`} className="bg-amber-50 rounded-lg p-4 border border-amber-100 scroll-mt-24">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Link
          href={`/meetings?id=${meeting.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 hover:underline"
          title="Open on the Meetings page"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Meeting: {meeting.title}
        </Link>
        {others.map((id) => (
          <LinkBadge key={id} type="contact" id={id} linkLabels={linkLabels} />
        ))}
      </div>
      {noteText(meeting.content).length === 0 ? (
        <p className="text-sm text-amber-800/70 italic">No notes yet for this meeting.</p>
      ) : (
        <NoteBody content={meeting.content} fade="from-amber-50" />
      )}
    </div>
  )
}

export default function NotesTimeline({
  entityType,
  entityId,
  notes,
  meetings,
  linkLabels,
  viewerMemberId,
  onEdit,
  onDelete,
  onOpenFile,
}: {
  entityType: NoteLinkEntityType
  entityId: string
  notes: TimelineNote[]
  meetings: TimelineMeeting[]
  linkLabels: LinkLabels
  viewerMemberId: string | null
  onEdit: (note: TimelineNote) => void
  onDelete: (note: TimelineNote) => void
  onOpenFile: (path: string) => void
}) {
  const items: TimelineItem[] = [
    ...notes.map((note): TimelineItem => ({ kind: 'note', date: note.note_date, note })),
    ...meetings.map((meeting): TimelineItem => ({ kind: 'meeting', date: meeting.date, meeting })),
  ]

  // Deep link (#note-<id>, e.g. from search) scrolls to the note and flashes it
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.startsWith('#note-') && !hash.startsWith('#meeting-')) return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-blue-400')
    const timer = setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2500)
    return () => clearTimeout(timer)
  }, [])

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">No notes yet</p>
        <p className="text-xs">Start typing above to write the first one</p>
      </div>
    )
  }

  const groups = new Map<string, TimelineItem[]>()
  for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item])
  const sorted = [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))

  return (
    <div className="space-y-6">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Previous notes ({items.length})</h3>
      {sorted.map(([date, dayItems]) => (
        <div key={date}>
          <h4 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatDay(date)}
          </h4>
          <div className="space-y-3">
            {dayItems.map((item) =>
              item.kind === 'note' ? (
                <NoteCard
                  key={item.note.id}
                  note={item.note}
                  entityType={entityType}
                  entityId={entityId}
                  linkLabels={linkLabels}
                  canEdit={!!viewerMemberId && item.note.author_id === viewerMemberId}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onOpenFile={onOpenFile}
                />
              ) : (
                <MeetingCard key={`meeting-${item.meeting.id}`} meeting={item.meeting} entityId={entityId} linkLabels={linkLabels} />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
