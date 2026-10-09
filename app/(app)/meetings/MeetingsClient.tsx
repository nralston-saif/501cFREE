'use client'

import '@liveblocks/react-tiptap/styles.css'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RoomProvider, ClientSideSuspense, useOthers, meetingRoomId } from '@/lib/liveblocks'
import dynamic from 'next/dynamic'

// The live editor (TipTap + Liveblocks' TipTap binding) loads in its own
// chunk, so the meeting list renders without waiting for it. It only renders
// inside a room on the client, so ssr: false changes nothing on the server.
const CollaborativeTiptapEditor = dynamic(
  () => import('@/components/meetings/CollaborativeTiptapEditor').then((m) => m.CollaborativeTiptapEditor),
  { ssr: false, loading: () => <div className="h-96 rounded-lg bg-gray-100 animate-pulse" aria-busy="true" /> }
)
import { KIND_LABELS } from '@/lib/contacts/names'
import {
  listMeetings,
  createMeeting,
  updateMeetingTitle,
  updateMeetingDate,
  saveMeetingContent,
  deleteMeeting,
  listAttendees,
  addAttendee,
  removeAttendee,
  searchContactsForAttendees,
  type MeetingRow,
  type AttendeeContact,
} from '@/lib/actions/meetings'

// Meetings: a list of meetings on the left, the selected meeting's notes on
// the right. All reads and writes go through the server actions in
// lib/actions/meetings.ts; the browser client is only used for the realtime
// subscription that keeps the list fresh. Live editing joins one Liveblocks
// room per meeting.

type Me = { memberId: string; name: string; isAdmin: boolean }
type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'


function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(value: string, long = false): string {
  const [y, m, d] = value.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(
    'en-US',
    long ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  const config = {
    saved: { text: '✓ Saved', color: 'text-green-600' },
    saving: { text: 'Saving...', color: 'text-blue-600' },
    error: { text: '⚠ Error saving', color: 'text-red-600' },
    unsaved: { text: 'Unsaved changes', color: 'text-gray-500' },
  }[status]
  return <span className={`text-xs ${config.color}`}>{config.text}</span>
}

// Debounced autosave of the meeting's HTML content
function useContentAutosave(meetingId: string, onSaved: (content: string) => void) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const schedule = useCallback(
    (content: string) => {
      setStatus('unsaved')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        setStatus('saving')
        const result = await saveMeetingContent(meetingId, content)
        if (!result.ok) {
          console.error('Error saving meeting notes:', result.error)
          setStatus('error')
        } else {
          onSaved(content)
          setStatus('saved')
          setTimeout(() => setStatus('idle'), 2000)
        }
      }, 2000)
    },
    [meetingId, onSaved]
  )

  return { status, schedule }
}

// ============================================================================
// MAIN
// ============================================================================

export default function MeetingsClient({
  initialMeetings,
  me,
  liveEnabled,
  initialSelectedId,
}: {
  initialMeetings: MeetingRow[]
  me: Me
  liveEnabled: boolean
  initialSelectedId?: string
}) {
  const [meetings, setMeetings] = useState<MeetingRow[]>(initialMeetings)
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialSelectedId && initialMeetings.some((m) => m.id === initialSelectedId) ? initialSelectedId : null) ??
      initialMeetings[0]?.id ??
      null
  )
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [toDelete, setToDelete] = useState<MeetingRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const selected = meetings.find((m) => m.id === selectedId) ?? null

  // The open meeting stays listed on refetch even when it's older than the list's cap
  const selectedIdRef = useRef(selectedId)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  const refetch = useCallback(async () => {
    const result = await listMeetings(selectedIdRef.current ?? undefined)
    if (result.ok) setMeetings(result.meetings)
  }, [])

  // Meetings created, renamed or deleted by someone else. Skipped in demo
  // mode, where the browser client is a stub without realtime.
  useEffect(() => {
    const supabase = createClient()
    if (typeof (supabase as { channel?: unknown }).channel !== 'function') return
    const channel = supabase
      .channel('meetings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, (payload) => {
        // Updates patch the row in place (the open meeting's body streams
        // through Liveblocks or its own editor state); inserts and deletes refetch
        if (payload.eventType === 'UPDATE') {
          const n = payload.new as MeetingRow
          setMeetings((prev) =>
            prev.map((m) =>
              m.id === n.id ? { ...m, title: n.title, meeting_date: n.meeting_date, content: n.content, updated_at: n.updated_at } : m
            )
          )
          return
        }
        refetch()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [refetch])

  // Keep ?id= in sync so the URL is a shareable deep link
  useEffect(() => {
    const url = new URL(window.location.href)
    if (selectedId) url.searchParams.set('id', selectedId)
    else url.searchParams.delete('id')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [selectedId])

  const updateMeeting = useCallback((id: string, patch: Partial<MeetingRow>) => {
    setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  async function handleDelete() {
    if (!toDelete) return
    const id = toDelete.id
    setDeleteError(null)
    const result = await deleteMeeting(id)
    if (!result.ok) {
      setDeleteError(result.error)
      return
    }
    setToDelete(null)
    setMeetings((prev) => prev.filter((m) => m.id !== id))
    if (selectedId === id) setSelectedId(meetings.find((m) => m.id !== id)?.id ?? null)
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? meetings.filter((m) => m.title.toLowerCase().includes(q) || (m.content ?? '').toLowerCase().includes(q))
    : meetings

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="card overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 space-y-3">
              <button type="button" onClick={() => setShowCreate(true)} className="btn btn-primary w-full">
                + New Meeting
              </button>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search meetings..."
                aria-label="Search meetings"
                className="input"
              />
            </div>
            <div className="divide-y divide-gray-100 max-h-[calc(100vh-320px)] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-500">
                  {q ? 'No meetings found' : 'No meetings yet. Start one to take notes together.'}
                </p>
              ) : (
                filtered.map((m) => {
                  const canDelete = me.isAdmin || m.created_by === me.memberId
                  return (
                    <div key={m.id} className={`relative group ${m.id === selectedId ? 'bg-gray-50 border-l-4 border-black' : ''}`}>
                      <button type="button" onClick={() => setSelectedId(m.id)} className="w-full text-left p-4 hover:bg-gray-50">
                        <p className="font-medium text-gray-900 text-sm truncate pr-6">{m.title}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(m.meeting_date)}</p>
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null)
                            setToDelete(m)
                          }}
                          className="absolute top-4 right-3 opacity-0 group-hover:opacity-100 text-red-600 hover:bg-red-50 rounded px-1 text-sm"
                          title="Delete meeting"
                          aria-label={`Delete ${m.title}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          {selected ? (
            <MeetingPane key={selected.id} meeting={selected} me={me} liveEnabled={liveEnabled} onUpdate={updateMeeting} />
          ) : (
            <div className="card p-12 text-center">
              <p className="text-gray-900 font-medium">No meeting selected</p>
              <p className="text-gray-500 text-sm mt-1">Pick a meeting from the list or start a new one.</p>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateMeetingModal
          onClose={() => setShowCreate(false)}
          onCreated={(m) => {
            setMeetings((prev) => [m, ...prev.filter((x) => x.id !== m.id)])
            setSelectedId(m.id)
            setShowCreate(false)
          }}
        />
      )}

      {toDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setToDelete(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-gray-900">Delete &ldquo;{toDelete.title}&rdquo;?</p>
            <p className="text-sm text-gray-600 mt-1">The notes and attendee list are removed for everyone.</p>
            {deleteError && <p className="text-sm text-red-600 mt-2">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setToDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================================
// CREATE
// ============================================================================

function CreateMeetingModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (m: MeetingRow) => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayLocal)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const result = await createMeeting(title, date)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated(result.meeting)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">New Meeting</h2>
        <div>
          <label htmlFor={`${fieldId}-title`} className="block text-sm font-medium text-gray-700 mb-1">
            Title
          </label>
          <input id={`${fieldId}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Grant pipeline review" autoFocus required />
        </div>
        <div>
          <label htmlFor={`${fieldId}-date`} className="block text-sm font-medium text-gray-700 mb-1">
            Date
          </label>
          <input id={`${fieldId}-date`} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <p className="text-xs text-gray-500">Visible to everyone on the team.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ============================================================================
// MEETING PANE (header + editor)
// ============================================================================

function MeetingPane({
  meeting,
  me,
  liveEnabled,
  onUpdate,
}: {
  meeting: MeetingRow
  me: Me
  liveEnabled: boolean
  onUpdate: (id: string, patch: Partial<MeetingRow>) => void
}) {
  const [timedOut, setTimedOut] = useState(false)
  const [connected, setConnected] = useState(false)

  // Fall back to a plain editor if the realtime connection never comes up
  // within 15s.
  useEffect(() => {
    if (!liveEnabled || connected) return
    const t = setTimeout(() => setTimedOut(true), 15000)
    return () => clearTimeout(t)
  }, [liveEnabled, connected])

  const onSaved = useCallback((content: string) => onUpdate(meeting.id, { content }), [meeting.id, onUpdate])
  const header = (right?: React.ReactNode) => (
    <div className="p-6 border-b border-gray-100 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <EditableTitle meeting={meeting} onSaved={(title) => onUpdate(meeting.id, { title })} />
        <EditableDate meeting={meeting} onSaved={(meeting_date) => onUpdate(meeting.id, { meeting_date })} />
        <MeetingAttendees meetingId={meeting.id} />
      </div>
      <div className="flex items-center gap-3 shrink-0">{right}</div>
    </div>
  )

  if (!liveEnabled || timedOut) {
    return (
      <div className="card p-0 overflow-hidden">
        {timedOut && (
          <p className="px-6 pt-4 text-sm text-amber-600">
            Real-time collaboration couldn&apos;t connect. You can keep editing without live sync.
          </p>
        )}
        <PlainEditor meeting={meeting} onSaved={onSaved} header={header} />
      </div>
    )
  }

  return (
    <RoomProvider
      id={meetingRoomId(meeting.id)}
      initialPresence={{ cursor: null, name: me.name, isTyping: false }}
      initialStorage={{ draft: '', sharedNoteId: null, meetingDate: todayLocal(), creatingNoteBy: null, noteLinks: null }}
    >
      <ClientSideSuspense
        fallback={
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-gray-300 border-t-black rounded-full" />
              <span className="text-gray-600">Connecting to real-time collaboration...</span>
            </div>
          </div>
        }
      >
        <LiveEditor
          meetingId={meeting.id}
          savedContent={meeting.content}
          onSaved={onSaved}
          onConnected={() => setConnected(true)}
          header={header}
        />
      </ClientSideSuspense>
    </RoomProvider>
  )
}

function LiveEditor({
  meetingId,
  savedContent,
  onSaved,
  onConnected,
  header,
}: {
  meetingId: string
  /** meetings.content when the editor opened: seeds an empty room */
  savedContent: string | null
  onSaved: (content: string) => void
  onConnected: () => void
  header: (right?: React.ReactNode) => React.ReactNode
}) {
  const others = useOthers()
  const { status, schedule } = useContentAutosave(meetingId, onSaved)

  useEffect(() => {
    onConnected()
  }, [onConnected])

  const typing = others.filter((o) => o.presence.isTyping).map((o) => o.presence.name || 'Someone')

  return (
    <div className="card p-0 overflow-hidden">
      {header(
        <>
          {others.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Also here:</span>
              <div className="flex -space-x-2">
                {others.slice(0, 5).map((o) => (
                  <div
                    key={o.connectionId}
                    className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center ring-2 ring-white"
                    title={o.presence.name || 'Anonymous'}
                  >
                    <span className="text-white text-xs font-medium">{(o.presence.name || '?').charAt(0).toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {typing.length > 0 && <span className="text-xs text-gray-500">{typing.join(', ')} typing...</span>}
          <SaveStatusIndicator status={status} />
        </>
      )}
      <div className="p-6">
        <CollaborativeTiptapEditor
          onContentChange={schedule}
          savedContent={savedContent}
          placeholder="Start typing your meeting notes... everyone here can edit together in real time."
          minHeight="400px"
        />
      </div>
    </div>
  )
}

function PlainEditor({
  meeting,
  onSaved,
  header,
}: {
  meeting: MeetingRow
  onSaved: (content: string) => void
  header: (right?: React.ReactNode) => React.ReactNode
}) {
  const [content, setContent] = useState(meeting.content ?? '')
  const { status, schedule } = useContentAutosave(meeting.id, onSaved)
  return (
    <>
      {header(<SaveStatusIndicator status={status} />)}
      <div className="p-6">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            schedule(e.target.value)
          }}
          placeholder="Start typing your meeting notes here..."
          aria-label="Meeting notes"
          className="input min-h-[300px] font-mono text-sm resize-y"
        />
      </div>
    </>
  )
}

function EditableTitle({ meeting, onSaved }: { meeting: MeetingRow; onSaved: (title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(meeting.title)
  // Reset the draft when the saved title changes (adjusting state during
  // render, rather than in an effect after an extra commit).
  const [syncedTitle, setSyncedTitle] = useState(meeting.title)
  if (meeting.title !== syncedTitle) {
    setSyncedTitle(meeting.title)
    setValue(meeting.title)
  }

  async function save() {
    const next = value.trim()
    setEditing(false)
    if (!next || next === meeting.title) {
      setValue(meeting.title)
      return
    }
    const result = await updateMeetingTitle(meeting.id, next)
    if (!result.ok) {
      console.error('Error renaming meeting:', result.error)
      setValue(meeting.title)
    } else {
      onSaved(next)
    }
  }

  if (editing) {
    return (
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        aria-label="Meeting title"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            setValue(meeting.title)
            setEditing(false)
          }
        }}
        autoFocus
        className="text-xl font-semibold text-gray-900 bg-transparent border-b-2 border-gray-300 focus:border-black focus:outline-none w-full max-w-md"
      />
    )
  }
  return (
    <h2
      onClick={() => setEditing(true)}
      className="text-xl font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 px-1 -mx-1 rounded"
      title="Click to edit title"
    >
      {meeting.title}
    </h2>
  )
}

function EditableDate({ meeting, onSaved }: { meeting: MeetingRow; onSaved: (meetingDate: string) => void }) {
  const [editing, setEditing] = useState(false)
  const current = meeting.meeting_date.split('T')[0]

  async function save(next: string) {
    setEditing(false)
    if (!next || next === current) return
    const result = await updateMeetingDate(meeting.id, next)
    if (!result.ok) console.error('Error changing meeting date:', result.error)
    else onSaved(next)
  }

  if (editing) {
    return (
      <input
        type="date"
        aria-label="Meeting date"
        defaultValue={current}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            setEditing(false)
          }
        }}
        autoFocus
        className="mt-1 text-sm text-gray-700 border border-gray-300 rounded px-1 focus:outline-none focus:border-black"
      />
    )
  }
  return (
    <p
      onClick={() => setEditing(true)}
      className="text-sm text-gray-500 mt-1 cursor-pointer hover:bg-gray-100 px-1 -mx-1 rounded inline-block"
      title="Click to change the date"
    >
      {formatDate(meeting.meeting_date, true)}
    </p>
  )
}

// ============================================================================
// ATTENDEES: contacts tagged on the meeting (shown on their contact pages)
// ============================================================================

function MeetingAttendees({ meetingId }: { meetingId: string }) {
  const [attendees, setAttendees] = useState<AttendeeContact[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AttendeeContact[]>([])
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const searchSeq = useRef(0)

  const loadAttendees = useCallback(async () => {
    const result = await listAttendees(meetingId)
    if (result.ok) setAttendees(result.attendees)
  }, [meetingId])

  useEffect(() => {
    let cancelled = false
    listAttendees(meetingId).then((result) => {
      if (!cancelled && result.ok) setAttendees(result.attendees)
    })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  // Debounced search while the picker is open; stale responses are dropped.
  // `searching` is raised by the handlers that (re)start a search: opening
  // the picker or changing the query while it's open.
  useEffect(() => {
    if (!open) return
    const seq = ++searchSeq.current
    const t = setTimeout(async () => {
      const result = await searchContactsForAttendees(query)
      if (seq !== searchSeq.current) return
      setResults(result.ok ? result.contacts : [])
      setSearching(false)
    }, 200)
    return () => clearTimeout(t)
  }, [open, query])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const attendeeIds = useMemo(() => new Set(attendees.map((a) => a.id)), [attendees])
  const choices = results.filter((c) => !attendeeIds.has(c.id))

  async function add(c: AttendeeContact) {
    if (query !== '') setSearching(true)
    setQuery('')
    setAttendees((prev) => [...prev, c])
    const result = await addAttendee(meetingId, c.id)
    if (!result.ok) {
      console.error('Error adding attendee:', result.error)
      loadAttendees()
    }
  }

  async function remove(c: AttendeeContact) {
    setAttendees((prev) => prev.filter((x) => x.id !== c.id))
    const result = await removeAttendee(meetingId, c.id)
    if (!result.ok) {
      console.error('Error removing attendee:', result.error)
      loadAttendees()
    }
  }

  return (
    <div ref={boxRef} className="relative mt-2 flex flex-wrap items-center gap-1.5">
      {attendees.map((c) => (
        <span
          key={c.id}
          className={`inline-flex items-center gap-1 text-xs font-medium pl-2 pr-1 py-0.5 rounded ${
            c.kind === 'person' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
          }`}
        >
          <Link href={`/contacts/${c.id}`} className="hover:underline">
            {c.display_name}
          </Link>
          <button type="button" onClick={() => remove(c)} className="rounded hover:bg-black/10 px-0.5 leading-none" aria-label={`Remove ${c.display_name}`}>
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => {
          if (!open) setSearching(true)
          setOpen(!open)
        }}
        className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
        title="Add the people and organizations at this meeting. It shows on their contact pages."
      >
        + Add attendee
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSearching(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false)
                setQuery('')
              }
            }}
            placeholder="Search contacts..."
            aria-label="Search contacts to add as attendee"
            className="w-full px-3 py-2 text-sm border-b border-gray-100 focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {choices.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">{searching ? 'Searching...' : 'No matches'}</p>
            )}
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => add(c)}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 flex items-center justify-between gap-2"
              >
                <span className="truncate">{c.display_name}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 shrink-0">
                  {KIND_LABELS[c.kind]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
