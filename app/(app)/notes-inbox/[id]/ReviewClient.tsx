'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CONTACT_ROLES,
  ORG_RELATIONSHIPS,
  applyCreatedContacts,
  buildCreationPlan,
  draftFromProposal,
  linkedOrganizations,
  mergeDraftNotes,
  splitLines,
  type ContactKind,
  type ContactRole,
  type DraftContact,
  type DraftNote,
  type NoteIntakeProposal,
  type OrgRef,
  type OrgRelationship,
  type ProposedLink,
  type ReviewDraft,
} from '@/lib/note-intake-core'
import type { NoteIntakeStatus } from '@/lib/supabase/types/database'
import {
  createContactsFromNote,
  discardNoteIntake,
  fileNoteIntake,
  saveNoteIntakeDraft,
  searchLinkTargets,
  type LinkTarget,
  type ReviewedNote,
} from '@/lib/actions/note-intake'
import { withBasePath } from '@/lib/basePath'
import { IntakeStatusBadge } from '../IntakeStatusBadge'

export type IntakeFileView = { name: string; mime: string | null; url: string | null }
export type FiledLink = { label: string; href: string }

type Busy = null | 'contacts' | 'file' | 'discard' | 'rerun'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const newKey = () => crypto.randomUUID()

function typeLabel(link: Pick<ProposedLink, 'entity_type' | 'contact_kind'>): string {
  switch (link.entity_type) {
    case 'contact':
      return link.contact_kind === 'organization' ? 'Organization' : link.contact_kind === 'person' ? 'Person' : 'Contact'
    case 'grant_proposal':
      return 'Grant'
    case 'pri':
      return 'PRI'
  }
}

const MATCH: Record<ProposedLink['confidence'], { label: string; dot: string }> = {
  high: { label: 'Strong match', dot: 'bg-green-500' },
  medium: { label: 'Likely match', dot: 'bg-amber-400' },
  low: { label: 'Possible match', dot: 'bg-gray-300' },
}


function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`
}

// ============================================================================
// Page
// ============================================================================

export default function ReviewClient({
  intakeId,
  status,
  error,
  proposal,
  draft,
  files,
  filedCount,
  filedLinks,
}: {
  intakeId: string
  status: NoteIntakeStatus
  error: string | null
  proposal: NoteIntakeProposal | null
  draft: ReviewDraft | null
  files: IntakeFileView[]
  filedCount: number
  filedLinks: FiledLink[]
}) {
  const router = useRouter()
  const [notes, setNotes] = useState<DraftNote[]>(
    () => draft?.notes ?? (proposal ? draftFromProposal(proposal, newKey).notes : [])
  )
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'discard' | 'rerun'>(null)
  // The notes the last finished autosave was for, and how it went. While the
  // current notes differ from those, a save is pending ('saving').
  const [lastSave, setLastSave] = useState<{ notes: DraftNote[]; state: SaveState }>(() => ({
    notes,
    state: 'idle',
  }))
  const saveState: SaveState =
    status === 'ready' && notes !== lastSave.notes ? 'saving' : lastSave.state

  // Poll while Claude is reading
  useEffect(() => {
    if (status !== 'processing') return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [status, router])

  // Autosave edits (debounced) so review can span sittings
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (status !== 'ready') return
    const timer = setTimeout(async () => {
      const res = await saveNoteIntakeDraft(intakeId, { version: 1, notes })
      setLastSave({ notes, state: res.ok ? 'saved' : 'error' })
    }, 1000)
    return () => clearTimeout(timer)
  }, [notes, intakeId, status])

  const plan = useMemo(() => buildCreationPlan(notes), [notes])
  const problems = useMemo(() => {
    const list = [...plan.problems]
    notes.forEach((n, i) => {
      const willLink = n.links.length + n.newContacts.filter((c) => c.include).length
      if (willLink === 0) {
        list.push(`${notes.length > 1 ? `Note ${i + 1}` : 'The note'} isn't filed onto anything yet. Add a link.`)
      }
      if (!n.summary.trim() && !n.transcript.trim()) {
        list.push(`${notes.length > 1 ? `Note ${i + 1}` : 'The note'} is empty.`)
      }
    })
    return list
  }, [plan, notes])

  function updateNote(key: string, patch: Partial<DraftNote>) {
    setNotes((prev) => prev.map((n) => (n.key === key ? { ...n, ...patch } : n)))
  }

  async function runClaude() {
    setBusy('rerun')
    setActionError(null)
    setConfirm(null)
    const res = await fetch(withBasePath(`/api/note-intake/${intakeId}/process`), { method: 'POST' }).catch(() => null)
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null
      setActionError(body?.error ?? 'Could not start. Try again.')
    }
    setBusy(null)
    router.refresh()
  }

  async function file() {
    if (problems.length) return
    setActionError(null)
    let current = notes

    // 1. Create the new contacts, then turn them into links (safe to retry)
    if (plan.items.length) {
      setBusy('contacts')
      const res = await createContactsFromNote(plan.items)
      current = applyCreatedContacts(current, plan.keyMap, res.created)
      setNotes(current)
      await saveNoteIntakeDraft(intakeId, { version: 1, notes: current })
      if (!res.ok) {
        setBusy(null)
        setActionError(res.error)
        return
      }
    }

    // 2. File the notes
    setBusy('file')
    const payload: ReviewedNote[] = current.map((n) => ({
      title: n.title.trim(),
      note_date: n.meeting_date || null,
      summary: n.summary,
      key_points: splitLines(n.keyPoints),
      follow_ups: splitLines(n.followUps),
      transcript: n.transcript,
      file_indexes: n.file_indexes,
      links: n.links.map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id })),
    }))
    const res = await fileNoteIntake(intakeId, payload)
    setBusy(null)
    if (!res.ok) {
      setActionError(res.error)
      return
    }
    router.refresh()
  }

  async function discard() {
    setBusy('discard')
    setActionError(null)
    const res = await discardNoteIntake(intakeId)
    if (!res.ok) {
      setBusy(null)
      setActionError(res.error)
      return
    }
    router.push('/notes-inbox')
  }

  const discardButton =
    status === 'filed' ? null : confirm === 'discard' ? (
      <span className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">Delete the files and draft?</span>
        <button onClick={discard} disabled={busy !== null} className="btn btn-danger text-sm">
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </button>
        <button onClick={() => setConfirm(null)} className="text-gray-500 hover:underline">
          Cancel
        </button>
      </span>
    ) : (
      <button onClick={() => setConfirm('discard')} disabled={busy !== null} className="text-sm text-gray-500 hover:text-red-600 hover:underline">
        Discard
      </button>
    )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Review notes</h1>
        <IntakeStatusBadge status={status} />
        {status === 'ready' && <SaveIndicator state={saveState} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <FilesPane files={files} />

        <div className="min-w-0">
          {status === 'processing' && (
            <div className="card flex items-center gap-3 p-6 text-sm text-gray-700">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-green-600" />
              <span>
                Claude is reading {files.length === 1 ? 'the file' : `${files.length} files`} and looking up contacts. This
                usually takes a minute or two. You can leave and come back.
              </span>
            </div>
          )}

          {(status === 'failed' || status === 'uploading') && (
            <div className="card space-y-3 p-6 text-sm">
              <p className="text-gray-800">
                {status === 'failed'
                  ? error ?? 'Something went wrong reading these files.'
                  : files.length
                    ? "These files haven't been sent to Claude yet."
                    : 'The upload didn’t finish. Discard this and drop the files again.'}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {files.length > 0 && (
                  <button onClick={runClaude} disabled={busy !== null} className="btn btn-primary text-sm">
                    {busy === 'rerun' ? 'Starting…' : status === 'failed' ? 'Try again' : 'Read files'}
                  </button>
                )}
                {discardButton}
              </div>
            </div>
          )}

          {status === 'filed' && (
            <div className="card space-y-4 p-6 text-sm">
              <p className="text-gray-800">
                Filed {plural(filedCount, 'note')}, with the original files attached.
              </p>
              {filedLinks.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Filed onto</p>
                  <div className="flex flex-wrap gap-2">
                    {filedLinks.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="rounded-full border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              <Link href="/notes-inbox" className="inline-block font-medium text-green-700 hover:underline">
                Drop more notes →
              </Link>
            </div>
          )}

          {status === 'ready' && (
            <div className="space-y-6">
              <Overview
                notes={notes}
                fileCount={files.length}
                createCount={plan.items.length}
                problems={problems}
                warnings={proposal?.warnings ?? []}
              />

              {notes.length === 0 && (
                <div className="card p-6 text-sm text-gray-700">
                  Claude didn&apos;t find any notes in these files. Re-read them, or discard.
                </div>
              )}

              {notes.length > 1 && (
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-700">
                  <span>Claude split these files into {notes.length} notes.</span>
                  <button
                    onClick={() => setNotes([mergeDraftNotes(notes, newKey)])}
                    className="font-medium text-green-700 hover:underline"
                  >
                    Merge into one note
                  </button>
                </div>
              )}

              {notes.map((note, i) => (
                <NoteCard
                  key={note.key}
                  index={i}
                  total={notes.length}
                  note={note}
                  files={files}
                  onChange={(patch) => updateNote(note.key, patch)}
                  onRemove={() => setNotes((prev) => prev.filter((n) => n.key !== note.key))}
                />
              ))}

              {/* Action bar */}
              <div className="sticky bottom-0 z-10 -mx-1 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur">
                {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={file}
                    disabled={busy !== null || notes.length === 0 || problems.length > 0}
                    className="btn btn-primary"
                  >
                    {busy === 'contacts'
                      ? 'Creating contacts…'
                      : busy === 'file'
                        ? 'Filing…'
                        : fileLabel(notes.length, plan.items.length)}
                  </button>
                  {problems.length > 0 && (
                    <span className="text-sm text-amber-700">{plural(problems.length, 'item')} above need{problems.length === 1 ? 's' : ''} your input</span>
                  )}
                  <span className="ml-auto flex items-center gap-4">
                    {confirm === 'rerun' ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span className="text-gray-600">Start over from the files? Your edits will be lost.</span>
                        <button onClick={runClaude} disabled={busy !== null} className="btn btn-secondary text-sm">
                          Re-read
                        </button>
                        <button onClick={() => setConfirm(null)} className="text-gray-500 hover:underline">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirm('rerun')} disabled={busy !== null} className="text-sm text-gray-500 hover:text-gray-800 hover:underline">
                        Re-read files
                      </button>
                    )}
                    {confirm !== 'rerun' && discardButton}
                  </span>
                </div>
              </div>
            </div>
          )}

          {status !== 'ready' && actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
        </div>
      </div>
    </div>
  )
}

function fileLabel(noteCount: number, createCount: number): string {
  const base = noteCount > 1 ? `File ${noteCount} notes` : 'File note'
  return createCount ? `${base} and create ${plural(createCount, 'contact')}` : base
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  const text = { saving: 'Saving…', saved: 'Edits saved', error: "Couldn't save edits" }[state]
  return <span className={`ml-auto text-xs ${state === 'error' ? 'text-red-600' : 'text-gray-400'}`}>{text}</span>
}

// ============================================================================
// Overview: what filing will do, and what still needs input
// ============================================================================

function Overview({
  notes,
  fileCount,
  createCount,
  problems,
  warnings,
}: {
  notes: DraftNote[]
  fileCount: number
  createCount: number
  problems: string[]
  warnings: string[]
}) {
  const linkCount = new Set(notes.flatMap((n) => n.links.map((l) => `${l.entity_type}:${l.entity_id}`))).size

  return (
    <div className="card p-5">
      <p className="text-sm text-gray-800">
        Claude read {plural(fileCount, 'file')} and drafted {plural(notes.length, 'note')}. Check the details below, then file.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        <OverviewRow icon="→" tone="gray">
          Files onto {plural(linkCount, 'existing record')}
        </OverviewRow>
        {createCount > 0 && (
          <OverviewRow icon="+" tone="green">
            Creates {plural(createCount, 'new contact')}
          </OverviewRow>
        )}
      </ul>

      {problems.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Needs your input</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-amber-900">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-800">
            {plural(warnings.length, 'note')} from Claude
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function OverviewRow({ icon, tone, children }: { icon: string; tone: 'gray' | 'green' | 'amber'; children: React.ReactNode }) {
  const colors = { gray: 'bg-gray-100 text-gray-500', green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-800' }
  return (
    <li className="flex items-center gap-2 text-gray-700">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${colors[tone]}`}>
        {icon}
      </span>
      {children}
    </li>
  )
}

// ============================================================================
// Original files
// ============================================================================

function FilesPane({ files }: { files: IntakeFileView[] }) {
  return (
    <div className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
      <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Original files</h2>
      {files.length === 0 && <p className="text-sm text-gray-500">No files.</p>}
      {files.map((f, i) => (
        <div key={i} className="card overflow-hidden">
          {f.url && f.mime?.startsWith('image/') && (
            <a href={f.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.name} className="max-h-[28rem] w-full bg-gray-50 object-contain" />
            </a>
          )}
          <div className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="text-xs text-gray-400">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-gray-800">{f.name}</span>
            {f.url && (
              <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0 text-green-700 hover:underline">
                Open
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// One note
// ============================================================================

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-100 pt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function NoteCard({
  index,
  total,
  note,
  files,
  onChange,
  onRemove,
}: {
  index: number
  total: number
  note: DraftNote
  files: IntakeFileView[]
  onChange: (patch: Partial<DraftNote>) => void
  onRemove: () => void
}) {
  return (
    <div className="card space-y-4 p-5">
      {total > 1 && (
        <div className="flex items-center">
          <span className="text-xs font-medium text-gray-400">
            Note {index + 1} of {total}
          </span>
          <button onClick={onRemove} className="ml-auto text-xs text-gray-400 hover:text-red-600 hover:underline">
            Remove this note
          </button>
        </div>
      )}

      <div className="space-y-3">
        <input
          value={note.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Title"
          aria-label="Title"
          className="w-full rounded-md border border-transparent px-2 py-1 -mx-2 text-lg font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-300 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 whitespace-nowrap text-gray-500">
            Meeting date
            <span className="w-44">
              <input
                type="date"
                value={note.meeting_date}
                onChange={(e) => onChange({ meeting_date: e.target.value })}
                className="input"
              />
            </span>
          </label>
          {!note.meeting_date && <span className="text-xs text-gray-400">Not in the notes. Today is used if blank.</span>}
        </div>
      </div>

      <Section title="Files onto" hint="Existing records this note will appear on.">
        <LinksEditor note={note} onChange={onChange} />
      </Section>

      <NewContactsSection note={note} onChange={onChange} />

      <Section title="Write-up">
        <div className="space-y-3">
          <Field label="Summary">
            <textarea
              value={note.summary}
              onChange={(e) => onChange({ summary: e.target.value })}
              rows={3}
              className="input w-full resize-y text-sm"
            />
          </Field>
          <Field label="Key points" hint="One per line">
            <textarea
              value={note.keyPoints}
              onChange={(e) => onChange({ keyPoints: e.target.value })}
              rows={Math.min(10, Math.max(3, note.keyPoints.split('\n').length))}
              className="input w-full resize-y text-sm"
            />
          </Field>
          <Field label="Follow-ups" hint="One per line">
            <textarea
              value={note.followUps}
              onChange={(e) => onChange({ followUps: e.target.value })}
              rows={Math.min(8, Math.max(2, note.followUps.split('\n').length))}
              className="input w-full resize-y text-sm"
            />
          </Field>
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-3 py-2 text-sm text-gray-600">
              Original notes <span className="text-gray-400">(Claude&apos;s transcription, saved with the note)</span>
            </summary>
            <textarea
              value={note.transcript}
              onChange={(e) => onChange({ transcript: e.target.value })}
              rows={12}
              aria-label="Original notes"
              className="input m-0 w-full resize-y rounded-none border-0 border-t font-mono text-xs"
            />
          </details>
        </div>
      </Section>

      {files.length > 1 && (
        <Section title="Attach original files">
          <div role="group" aria-label="Attach original files" className="flex flex-wrap gap-3">
            {files.map((f, i) => (
              <label key={i} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={note.file_indexes.includes(i)}
                  onChange={(e) =>
                    onChange({
                      file_indexes: e.target.checked
                        ? [...note.file_indexes, i].sort((a, b) => a - b)
                        : note.file_indexes.filter((x) => x !== i),
                    })
                  }
                />
                <span className="max-w-[16rem] truncate">{f.name}</span>
              </label>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-gray-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-gray-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function TypeTag({ link }: { link: Pick<ProposedLink, 'entity_type' | 'contact_kind'> }) {
  return <span className="w-24 shrink-0 text-xs text-gray-400">{typeLabel(link)}</span>
}

// ============================================================================
// Links to existing records
// ============================================================================

function LinksEditor({ note, onChange }: { note: DraftNote; onChange: (patch: Partial<DraftNote>) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LinkTarget[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  async function search() {
    if (query.trim().length < 2) return
    setSearching(true)
    setSearchError(null)
    const res = await searchLinkTargets(query)
    setSearching(false)
    if (!res.ok) setSearchError(res.error)
    else setResults(res.targets)
  }

  function remove(link: ProposedLink) {
    onChange({ links: note.links.filter((l) => !(l.entity_type === link.entity_type && l.entity_id === link.entity_id)) })
  }

  return (
    <div>
      {note.links.length === 0 ? (
        <p className="text-sm text-gray-400">No existing records matched.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {note.links.map((l) => (
            <li key={`${l.entity_type}:${l.entity_id}`} className="flex items-start gap-3 px-3 py-2">
              <TypeTag link={l} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{l.label}</p>
                {l.evidence && <p className="mt-0.5 text-xs italic text-gray-500">{l.evidence}</p>}
              </div>
              {l.evidence && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
                  <span className={`h-2 w-2 rounded-full ${MATCH[l.confidence].dot}`} />
                  {MATCH[l.confidence].label}
                </span>
              )}
              <button
                onClick={() => remove(l)}
                className="shrink-0 px-1 text-gray-400 hover:text-red-600"
                aria-label={`Remove ${l.label}`}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <div className="min-w-0 flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                search()
              }
            }}
            placeholder="Add a record: search people, organizations, grants, PRIs"
            aria-label="Search records to add"
            className="input"
          />
        </div>
        <button onClick={search} disabled={searching || query.trim().length < 2} className="btn btn-secondary text-sm">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {searchError && <p className="mt-1 text-xs text-red-600">{searchError}</p>}
      {results && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matches. Add them as a new contact below.</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.entity_type}:${r.entity_id}`}
                onClick={() => {
                  if (!note.links.some((l) => l.entity_type === r.entity_type && l.entity_id === r.entity_id)) {
                    onChange({ links: [...note.links, { ...r, confidence: 'high', evidence: '' }] })
                  }
                  setResults(null)
                  setQuery('')
                }}
                className="flex w-full items-baseline gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-gray-50"
              >
                <TypeTag link={r} />
                <span className="text-gray-900">{r.label}</span>
                {r.detail && <span className="truncate text-xs text-gray-500">{r.detail}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// New contacts: organizations with their people nested under them
// ============================================================================

function blankContact(kind: ContactKind, org: OrgRef = { type: 'none' }): DraftContact {
  return {
    key: newKey(),
    include: true,
    kind,
    name: '',
    email: '',
    role: 'contact',
    org,
    relationship: org.type === 'none' ? '' : 'employee',
    title: '',
    organizationHint: null,
    evidence: '',
  }
}

function NewContactsSection({
  note,
  onChange,
}: {
  note: DraftNote
  onChange: (patch: Partial<DraftNote>) => void
}) {
  const organizations = note.newContacts.filter((c) => c.kind === 'organization')
  const people = note.newContacts.filter((c) => c.kind === 'person')
  const peopleUnder = (key: string) => people.filter((p) => p.org.type === 'new' && p.org.key === key)
  const loosePeople = people.filter((p) => p.org.type !== 'new' || !organizations.some((c) => c.key === (p.org as { key: string }).key))

  const orgOptions: { value: string; label: string; ref: OrgRef }[] = [
    { value: 'none', label: 'No organization', ref: { type: 'none' } },
    ...organizations.map((c) => ({ value: `new:${c.key}`, label: `${c.name || 'New organization'} (new)`, ref: { type: 'new' as const, key: c.key } })),
    ...linkedOrganizations(note.links)
      .map((l) => ({ value: `existing:${l.entity_id}`, label: l.label, ref: { type: 'existing' as const, id: l.entity_id, label: l.label } })),
  ]

  function update(key: string, patch: Partial<DraftContact>) {
    onChange({ newContacts: note.newContacts.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
  }
  function add(contact: DraftContact) {
    onChange({ newContacts: [...note.newContacts, contact] })
  }
  function remove(key: string) {
    onChange({
      newContacts: note.newContacts
        .filter((c) => c.key !== key)
        // People under a removed organization keep their card, without it
        .map((c) => (c.org.type === 'new' && c.org.key === key ? { ...c, org: { type: 'none' as const }, relationship: '' as const } : c)),
    })
  }
  /** Claude named an organization we can't link: add it as a new one */
  function addHintedOrg(person: DraftContact) {
    const org = { ...blankContact('organization'), name: person.organizationHint ?? '', role: person.role }
    onChange({
      newContacts: [
        ...note.newContacts.map((c) =>
          c.key === person.key
            ? { ...c, org: { type: 'new' as const, key: org.key }, organizationHint: null, relationship: c.relationship || ('employee' as const) }
            : c
        ),
        org,
      ],
    })
  }

  const total = note.newContacts.filter((c) => c.include).length

  return (
    <Section
      title={`New contacts${total ? ` · ${total} to create` : ''}`}
      hint={
        note.newContacts.length
          ? "Claude couldn't find these. They're created when you file. Uncheck any you don't want."
          : undefined
      }
    >
      <div className="space-y-3">
        {organizations.map((organization) => (
          <div key={organization.key} className={`overflow-hidden rounded-lg border ${organization.include ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-60'}`}>
            <ContactRow
              contact={organization}
              orgOptions={orgOptions}
              onChange={(patch) => update(organization.key, patch)}
              onRemove={() => remove(organization.key)}
              header
            />
            {peopleUnder(organization.key).map((person) => (
              <div key={person.key} className="border-t border-gray-100 pl-6">
                <ContactRow
                  contact={person}
                  orgOptions={orgOptions}
                  orgName={organization.name || 'this organization'}
                  onChange={(patch) => update(person.key, patch)}
                  onRemove={() => remove(person.key)}
                  onAddHintedOrg={() => addHintedOrg(person)}
                />
              </div>
            ))}
            <div className="border-t border-gray-100 px-3 py-2 pl-9">
              <button
                onClick={() => add({ ...blankContact('person', { type: 'new', key: organization.key }), role: organization.role })}
                className="text-xs font-medium text-green-700 hover:underline"
              >
                + Add a person at {organization.name || 'this organization'}
              </button>
            </div>
          </div>
        ))}

        {loosePeople.map((person) => (
          <div key={person.key} className={`rounded-lg border ${person.include ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-60'}`}>
            <ContactRow
              contact={person}
              orgOptions={orgOptions}
              orgName={person.org.type === 'existing' ? person.org.label : undefined}
              onChange={(patch) => update(person.key, patch)}
              onRemove={() => remove(person.key)}
              onAddHintedOrg={() => addHintedOrg(person)}
            />
          </div>
        ))}

        <div className="flex gap-4 text-sm">
          <button onClick={() => add(blankContact('person'))} className="font-medium text-green-700 hover:underline">
            + New person
          </button>
          <button onClick={() => add(blankContact('organization'))} className="font-medium text-green-700 hover:underline">
            + New organization
          </button>
        </div>
      </div>
    </Section>
  )
}

function ContactRow({
  contact,
  orgOptions,
  orgName,
  header,
  onChange,
  onRemove,
  onAddHintedOrg,
}: {
  contact: DraftContact
  orgOptions: { value: string; label: string; ref: OrgRef }[]
  orgName?: string
  header?: boolean
  onChange: (patch: Partial<DraftContact>) => void
  onRemove: () => void
  onAddHintedOrg?: () => void
}) {
  const isPerson = contact.kind === 'person'
  const orgValue =
    contact.org.type === 'new' ? `new:${contact.org.key}` : contact.org.type === 'existing' ? `existing:${contact.org.id}` : 'none'
  const disabled = !contact.include

  // Note: .input is width:100% (globals.css), so layout comes from grid cells
  return (
    <div className={`space-y-2 px-3 py-3 ${header ? 'bg-gray-50' : ''}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_5.5rem_minmax(0,1fr)_11rem_auto]">
        <input
          type="checkbox"
          checked={contact.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Create ${contact.name || 'this contact'}`}
          title="Create when filing"
        />
        <span className="hidden text-xs text-gray-400 sm:block">{isPerson ? 'Person' : 'Organization'}</span>
        <input
          value={contact.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={isPerson ? 'Full name' : 'Organization name'}
          aria-label="Name"
          disabled={disabled}
          className="input font-medium"
        />
        <label className="col-start-2 block sm:col-start-auto">
          <span className="block text-[11px] leading-tight text-gray-400">Relationship to your organization</span>
          <select
            value={contact.role || 'contact'}
            onChange={(e) => onChange({ role: e.target.value as ContactRole })}
            disabled={disabled}
            className="input"
          >
            {CONTACT_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onRemove}
          className="row-start-1 col-start-3 px-1 text-lg leading-none text-gray-400 hover:text-red-600 sm:col-start-5"
          aria-label="Remove"
          title="Remove"
        >
          ×
        </button>
      </div>

      {isPerson && (
        <div className="grid grid-cols-1 gap-2 sm:ml-[7.25rem] sm:grid-cols-2">
          <input
            value={contact.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="Email (optional)"
            aria-label="Email"
            disabled={disabled}
            className="input"
          />
          <select
            // Remount when options change: Chrome can leave a stale label otherwise
            key={orgOptions.map((o) => `${o.value}=${o.label}`).join('|')}
            value={orgValue}
            onChange={(e) => {
              const option = orgOptions.find((o) => o.value === e.target.value)
              if (!option) return
              onChange({
                org: option.ref,
                relationship: option.ref.type === 'none' ? '' : contact.relationship || 'employee',
                title: option.ref.type === 'none' ? '' : contact.title,
              })
            }}
            aria-label="Organization"
            disabled={disabled}
            className="input"
          >
            {orgOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {contact.org.type !== 'none' && (
            <>
              <select
                value={contact.relationship}
                onChange={(e) => onChange({ relationship: e.target.value as OrgRelationship | '' })}
                aria-label={`Role at ${orgName ?? 'organization'}`}
                disabled={disabled}
                className={`input ${contact.include && !contact.relationship ? '!border-amber-400' : ''}`}
              >
                <option value="">Role at organization…</option>
                {ORG_RELATIONSHIPS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <input
                value={contact.title}
                onChange={(e) => onChange({ title: e.target.value })}
                placeholder="Title, e.g. CTO"
                aria-label="Title at organization"
                disabled={disabled}
                className="input"
              />
            </>
          )}
        </div>
      )}

      {(contact.evidence || contact.organizationHint) && (
        <div className="space-y-1 text-xs sm:ml-[7.25rem]">
          {contact.evidence && <p className="italic text-gray-500">{contact.evidence}</p>}
          {contact.organizationHint && contact.org.type === 'none' && onAddHintedOrg && (
            <p className="text-gray-600">
              Claude says they&apos;re with <span className="font-medium">{contact.organizationHint}</span>, which isn&apos;t in your contacts.{' '}
              <button onClick={onAddHintedOrg} className="font-medium text-green-700 hover:underline">
                Add it as a new organization
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
