'use client'

import { useEffect, useRef, useState } from 'react'
import { createNote, deleteNote, setNoteLinks, updateNote } from '@/lib/actions/notes'
import RichTextEditor from './LazyRichTextEditor'
import { linkKey, noteText, type NoteLinkChip } from './types'

// Write side of the notes section. The note autosaves two seconds after
// typing stops (created on the first save, updated after), so nothing is
// lost if the page closes; "Done" finishes it and clears the editor for the
// next one. Link chips decide which other records the note also shows on.
// Clearing every word of a saved note never saves an empty note: the saved
// text stays and the composer offers to delete the note instead.

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'emptied'

const AUTOSAVE_MS = 2000

const chipKey = (c: { entityType: string; entityId: string }) => linkKey(c.entityType, c.entityId)
const linksKey = (chips: NoteLinkChip[]) => chips.map(chipKey).sort().join('|')
const linkTargets = (chips: NoteLinkChip[]) => chips.map((c) => ({ entityType: c.entityType, entityId: c.entityId }))

const ICON_PATHS = {
  person: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  organization:
    'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  document:
    'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  trend: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
}

function ChipIcon({ chip }: { chip: Pick<NoteLinkChip, 'entityType' | 'contactKind'> }) {
  const path =
    chip.entityType === 'contact'
      ? ICON_PATHS[chip.contactKind === 'organization' ? 'organization' : 'person']
      : chip.entityType === 'grant_proposal'
        ? ICON_PATHS.document
        : chip.entityType === 'pri'
          ? ICON_PATHS.trend
          : ICON_PATHS.calendar
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
    </svg>
  )
}

function SaveStatusIndicator({
  status,
  onRetry,
  onDelete,
}: {
  status: SaveStatus
  onRetry: () => void
  onDelete: () => void
}) {
  if (status === 'idle') return null
  return (
    <div className="flex items-center gap-2 text-sm" aria-live="polite">
      {status === 'emptied' && (
        <>
          <span className="text-gray-600">Empty. The saved note keeps its last text.</span>
          <button
            type="button"
            onClick={onDelete}
            className="px-2 py-0.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
          >
            Delete note
          </button>
        </>
      )}
      {status === 'unsaved' && (
        <>
          <span className="w-2 h-2 bg-yellow-500 rounded-full" />
          <span className="text-yellow-600">Unsaved changes</span>
        </>
      )}
      {status === 'saving' && <span className="text-blue-600">Saving…</span>}
      {status === 'saved' && (
        <>
          <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-600">Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="text-red-600">Error saving — your text is still in the editor</span>
          <button
            type="button"
            onClick={onRetry}
            className="px-2 py-0.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
          >
            Retry
          </button>
        </>
      )}
    </div>
  )
}

export default function NoteComposer({
  primary,
  autoLinks = [],
  suggestedLinks = [],
  placeholder,
  today,
  onOpenNoteChange,
  onDone,
}: {
  /** The record this page is about; always the note's primary link */
  primary: NoteLinkChip
  /** Pre-attached, removable links (e.g. a person's current organization) */
  autoLinks?: NoteLinkChip[]
  /** One-click link suggestions */
  suggestedLinks?: NoteLinkChip[]
  placeholder?: string
  /** Today (YYYY-MM-DD) in the organization's time zone; the default note date */
  today: string
  /** The saved-but-still-open note, so the timeline can leave it out */
  onOpenNoteChange: (noteId: string | null) => void
  /** A note was finished; reload the timeline */
  onDone: () => void
}) {
  const [content, setContent] = useState('')
  const [noteDate, setNoteDate] = useState(today)
  const [noteId, setNoteId] = useState<string | null>(null)
  const [attached, setAttached] = useState<NoteLinkChip[]>(autoLinks)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [editorKey, setEditorKey] = useState(0)

  // Latest values for the async save loop
  const contentRef = useRef('')
  const dateRef = useRef(noteDate)
  const noteIdRef = useRef<string | null>(null)
  const attachedRef = useRef(attached)
  const lastSavedRef = useRef('')
  const inflightRef = useRef<Promise<void> | null>(null)

  const candidates = [...autoLinks, ...suggestedLinks].filter((c) => chipKey(c) !== chipKey(primary))
  const attachedKeys = new Set(attached.map(chipKey))
  const detached = candidates.filter((c) => !attachedKeys.has(chipKey(c)))

  async function save(): Promise<boolean> {
    // One save at a time: a second call waits, then saves whatever is newer
    while (inflightRef.current) await inflightRef.current
    const text = contentRef.current.trim()
    if (!noteText(text) || text === lastSavedRef.current) return true

    setStatus('saving')
    let ok = false
    const run = (async () => {
      if (noteIdRef.current) {
        const res = await updateNote(noteIdRef.current, { content: text, noteDate: dateRef.current })
        ok = res.ok
      } else {
        const sentDate = dateRef.current
        const sentLinks = attachedRef.current
        const res = await createNote({
          entityType: primary.entityType,
          entityId: primary.entityId,
          content: text,
          noteDate: sentDate,
          links: linkTargets(sentLinks),
        })
        ok = res.ok
        if (res.ok) {
          noteIdRef.current = res.noteId
          setNoteId(res.noteId)
          onOpenNoteChange(res.noteId)
          // Date or link changes made while the note was being created
          // couldn't be sent on their own (no note yet); apply them now
          if (dateRef.current !== sentDate) {
            const dateRes = await updateNote(res.noteId, { noteDate: dateRef.current })
            if (!dateRes.ok) ok = false
          }
          if (linksKey(attachedRef.current) !== linksKey(sentLinks)) {
            const linkRes = await setNoteLinks(res.noteId, linkTargets(attachedRef.current))
            if (!linkRes.ok) setLinkError(linkRes.error)
          }
        }
      }
    })()
    inflightRef.current = run
    try {
      await run
    } catch {
      ok = false
    } finally {
      inflightRef.current = null
    }
    if (ok) lastSavedRef.current = text
    const now = contentRef.current.trim()
    setStatus(!ok ? 'error' : now === text ? 'saved' : noteText(now) ? 'unsaved' : 'emptied')
    return ok
  }

  // Flush pending text when the composer goes away (in-app navigation) or the
  // tab is hidden or closed; the server action keeps running after unmount
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    const flush = () => {
      const text = contentRef.current.trim()
      if (noteText(text) && text !== lastSavedRef.current) void saveRef.current()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [])

  // Autosave after typing pauses
  useEffect(() => {
    if (!noteText(content) || content.trim() === lastSavedRef.current) return
    const timer = setTimeout(() => void save(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
    // save reads refs; re-arm only when the text changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // Warn before leaving with unsaved text
  useEffect(() => {
    if (status !== 'unsaved' && status !== 'saving' && status !== 'error') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  function changeContent(html: string) {
    contentRef.current = html
    setContent(html)
    if (!noteText(html)) setStatus(noteIdRef.current ? 'emptied' : 'idle')
    else setStatus(html.trim() === lastSavedRef.current ? 'saved' : 'unsaved')
  }

  // Dates and links save immediately once the note exists; content changes
  // go through the autosave above
  async function changeDate(date: string) {
    if (!date) return
    dateRef.current = date
    setNoteDate(date)
    // Before the note exists, save() sends (or reapplies) the latest date
    if (noteIdRef.current) {
      const res = await updateNote(noteIdRef.current, { noteDate: date })
      if (!res.ok) setStatus('error')
    }
  }

  async function toggleLink(chip: NoteLinkChip, attach: boolean) {
    const next = attach ? [...attached, chip] : attached.filter((c) => chipKey(c) !== chipKey(chip))
    attachedRef.current = next
    setAttached(next)
    setLinkError(null)
    // Before the note exists, save() sends (or reapplies) the latest links
    if (noteIdRef.current) {
      const res = await setNoteLinks(noteIdRef.current, linkTargets(next))
      if (!res.ok) setLinkError(res.error)
    }
  }

  // Finish the note: save pending text, then clear the editor for the next one
  async function finish() {
    if (noteText(contentRef.current) && !(await save())) return
    reset()
  }

  // The editor was emptied: delete the saved note (the author's own; the
  // server checks) and start fresh
  async function removeEmptiedNote() {
    while (inflightRef.current) await inflightRef.current
    const id = noteIdRef.current
    if (!id || noteText(contentRef.current)) return
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    setStatus('saving')
    const res = await deleteNote(id)
    if (!res.ok) {
      setStatus('emptied')
      setLinkError(res.error)
      return
    }
    reset()
  }

  function reset() {
    contentRef.current = ''
    lastSavedRef.current = ''
    noteIdRef.current = null
    dateRef.current = today
    attachedRef.current = autoLinks
    setContent('')
    setNoteId(null)
    setNoteDate(dateRef.current)
    setAttached(autoLinks)
    setStatus('idle')
    setLinkError(null)
    setEditorKey((k) => k + 1)
    onOpenNoteChange(null)
    onDone()
  }

  const editingPastNote = !!noteId && noteDate < today

  return (
    <div
      className={`bg-white rounded-xl border p-4 ${status === 'error' ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-200'}`}
    >
      {/* Where this note will appear */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          <ChipIcon chip={primary} /> {primary.label}
        </span>
        {attached.map((chip) => (
          <span
            key={chipKey(chip)}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
          >
            <ChipIcon chip={chip} /> {chip.label}
            <button
              type="button"
              onClick={() => toggleLink(chip, false)}
              className="ml-0.5 px-1 text-blue-300 hover:text-blue-600"
              title={`Don't link this note to ${chip.label}`}
              aria-label={`Remove link to ${chip.label}`}
            >
              ✕
            </button>
          </span>
        ))}
        {detached.map((chip) => (
          <button
            key={chipKey(chip)}
            type="button"
            onClick={() => toggleLink(chip, true)}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white text-gray-400 border border-dashed border-gray-300 hover:text-blue-600 hover:border-blue-300 transition-colors"
            title={`Also link this note to ${chip.label}`}
          >
            + {chip.label}
          </button>
        ))}
      </div>
      {linkError && <p className="text-xs text-red-600 mb-2">{linkError}</p>}

      {/* Never silently append today's typing to an old note */}
      {editingPastNote && (
        <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <span>Editing the note from {noteDate}. New conversation?</span>
          <button
            type="button"
            onClick={finish}
            className="px-2.5 py-1 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 whitespace-nowrap"
          >
            Start a new note
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <label className="flex-1 min-w-40">
          <span className="block text-sm font-medium text-gray-700 mb-1">Date</span>
          <input type="date" value={noteDate} onChange={(e) => changeDate(e.target.value)} className="input" />
        </label>
        <div className="flex items-center gap-3 pb-2">
          <SaveStatusIndicator status={status} onRetry={() => void save()} onDelete={() => void removeEmptiedNote()} />
          {noteText(content) && (
            <button
              type="button"
              onClick={finish}
              disabled={status === 'saving'}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
              title="Finish this note and clear the editor for the next one"
            >
              Done
            </button>
          )}
        </div>
      </div>

      <RichTextEditor
        key={editorKey}
        onChange={changeContent}
        placeholder={placeholder ?? `Add notes about ${primary.label}… Changes save automatically.`}
        minHeight="200px"
        ariaLabel="New note"
      />
    </div>
  )
}
