'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import DemoSampleNote from '@/components/DemoSampleNote'
import { useDemoRun } from '@/components/useDemoRun'
import { ACCEPT_ATTR, ACCEPTED_LABEL, MAX_FILES_PER_INTAKE, checkFile } from '@/lib/note-intake-core'
import type { NoteIntakeProposal, ProposedLink } from '@/lib/note-intake-core/proposal'
import { DEMO_DELAY_MS, DEMO_NOTES } from '@/lib/ai/demo-label'
import { scriptedNoteIntake, type DemoContact, type DemoRecord } from '@/lib/ai/demo-scripts'
import { formatDate } from '@/lib/utils/dates'

const SAMPLE_FILE = 'check-in-call-notes.jpg'

function linkHref(link: ProposedLink): string {
  if (link.entity_type === 'grant_proposal') return `/grants-out/proposals/${link.entity_id}`
  if (link.entity_type === 'pri') return `/pris/${link.entity_id}`
  return `/contacts/${link.entity_id}`
}

function linkKind(link: ProposedLink): string {
  if (link.entity_type === 'grant_proposal') return 'Grant proposal'
  if (link.entity_type === 'pri') return 'PRI'
  return link.contact_kind === 'organization' ? 'Organization' : 'Person'
}

/**
 * The notes inbox in demo mode without a key. Dropped files (or the sample
 * file) are never uploaded or read: after a few seconds the page shows
 * pre-written notes linked to the demo contacts, built in the browser by
 * scriptedNoteIntake(). Nothing is saved and nothing navigates.
 */
export default function DemoNotesInbox({
  contacts,
  records,
  today,
}: {
  contacts: DemoContact[]
  records: DemoRecord[]
  today: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [fileNames, setFileNames] = useState<string[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const { running, result, run, reset } = useDemoRun<NoteIntakeProposal>(DEMO_DELAY_MS.notesInbox)

  function start(names: string[]) {
    if (running || names.length === 0) return
    setFileNames(names)
    run(() => scriptedNoteIntake(names, contacts, records, today))
  }

  function addFiles(list: FileList) {
    const accepted: string[] = []
    const skipped: string[] = []
    for (const file of Array.from(list)) {
      const check = checkFile(file.name, file.size)
      if (!check.ok) skipped.push(`${file.name}: ${check.reason}`)
      else if (accepted.length >= MAX_FILES_PER_INTAKE) skipped.push(`${file.name}: up to ${MAX_FILES_PER_INTAKE} files per upload.`)
      else accepted.push(file.name)
    }
    setRejected(skipped)
    start(accepted)
  }

  return (
    <div className="mb-8">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!running) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'
        } ${running ? 'pointer-events-none opacity-60' : ''}`}
      >
        <p className="text-sm font-medium text-gray-900">Drop meeting notes here</p>
        <p className="mt-1 text-xs text-gray-500">
          {ACCEPTED_LABEL}. In this demo files are not uploaded or read.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="btn btn-secondary text-sm">
            Choose files
          </button>
          <button type="button" onClick={() => start([SAMPLE_FILE])} className="btn btn-primary text-sm">
            Try it with a sample file
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          aria-label="Choose note files"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {running && (
        <p className="mt-4 text-sm text-gray-500 animate-pulse">
          Reading {fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`} with Claude… (demo)
        </p>
      )}

      {!running && result && (
        <div className="mt-4 space-y-4">
          <DemoSampleNote>{DEMO_NOTES.notesInbox}</DemoSampleNote>
          {result.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-amber-800">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {result.notes.map((note, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div>
                <h3 className="font-medium text-gray-900">{note.title}</h3>
                <p className="text-xs text-gray-500">
                  {note.meeting_date ? formatDate(note.meeting_date) : 'No date'}
                  {note.file_indexes.length > 0 &&
                    ` · from ${note.file_indexes.map((idx) => fileNames[idx]).filter(Boolean).join(', ')}`}
                </p>
              </div>
              <p className="text-sm text-gray-700">{note.summary}</p>
              {note.key_points.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Key points</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-sm text-gray-700">
                    {note.key_points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {note.follow_ups.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Follow-ups</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-sm text-gray-700">
                    {note.follow_ups.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {note.links.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Would be filed on</p>
                  <ul className="space-y-1">
                    {note.links.map((link) => (
                      <li key={`${link.entity_type}:${link.entity_id}`} className="text-sm">
                        <Link href={linkHref(link)} className="font-medium text-gray-900 underline hover:text-gray-700">
                          {link.label}
                        </Link>{' '}
                        <span className="text-xs text-gray-500">
                          {linkKind(link)} · {link.confidence} confidence
                        </span>
                        <span className="block text-xs text-gray-500">{link.evidence}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {note.new_contacts.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Suggested new contact</p>
                  <ul className="space-y-1">
                    {note.new_contacts.map((c) => (
                      <li key={c.name} className="text-sm text-gray-700">
                        <span className="font-medium text-gray-900">{c.name}</span>
                        {[c.title, c.organization, c.email].filter(Boolean).length > 0 &&
                          ` · ${[c.title, c.organization, c.email].filter(Boolean).join(' · ')}`}
                        <span className="block text-xs text-gray-500">{c.evidence}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              reset()
              setFileNames([])
              setRejected([])
            }}
            className="text-sm text-gray-500 hover:underline"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
