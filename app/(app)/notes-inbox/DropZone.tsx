'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ACCEPT_ATTR,
  ACCEPTED_LABEL,
  MAX_FILES_PER_INTAKE,
  checkFile,
  storagePathFor,
} from '@/lib/note-intake-core'
import { createClient } from '@/lib/supabase/client'
import { createNoteIntake } from '@/lib/actions/note-intake'
import { withBasePath } from '@/lib/basePath'

type Staged = { key: string; file: File; mime: string }
type Rejected = { key: string; name: string; reason: string }

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Files collect here (drop or choose, as many times as needed) and nothing
// uploads until the user submits. Then: create an intake → upload each file
// straight to the note-files bucket under the viewer's session (no server
// body-size cap) → kick off Claude → go to the review page.
export default function DropZone() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [staged, setStaged] = useState<Staged[]>([])
  const [rejected, setRejected] = useState<Rejected[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function addFiles(list: FileList | File[]) {
    if (busy) return
    setError(null)
    const next = [...staged]
    const newlyRejected: Rejected[] = []
    for (const file of Array.from(list)) {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (next.some((s) => s.key === key)) continue
      const check = checkFile(file.name, file.size)
      if (!check.ok) {
        newlyRejected.push({ key: `${key}:${Math.random()}`, name: file.name, reason: check.reason })
      } else if (next.length >= MAX_FILES_PER_INTAKE) {
        newlyRejected.push({ key: `${key}:${Math.random()}`, name: file.name, reason: `Up to ${MAX_FILES_PER_INTAKE} files per upload.` })
      } else {
        next.push({ key, file, mime: check.mime })
      }
    }
    setStaged(next)
    setRejected((prev) => [...prev, ...newlyRejected])
  }

  async function submit() {
    if (busy || staged.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const created = await createNoteIntake()
      if (!created.ok) throw new Error(created.error)
      const intakeId = created.id
      const supabase = createClient()

      for (const [i, { file, mime }] of staged.entries()) {
        setProgress(`Uploading ${i + 1} of ${staged.length}: ${file.name}`)
        const path = storagePathFor(intakeId, file.name, crypto.randomUUID())
        const { error: rowError } = await supabase.from('note_intake_files').insert({
          intake_id: intakeId,
          storage_path: path,
          file_name: file.name,
          mime_type: mime,
          size_bytes: file.size,
        })
        if (rowError) throw new Error(`Couldn't record ${file.name}: ${rowError.message}`)
        const { error: uploadError } = await supabase.storage
          .from('note-files')
          .upload(path, file, { contentType: mime, upsert: false })
        if (uploadError) throw new Error(`Couldn't upload ${file.name}: ${uploadError.message}`)
      }

      setProgress('Sending to Claude…')
      // Failures here surface on the review page, which offers a retry
      await fetch(withBasePath(`/api/note-intake/${intakeId}/process`), { method: 'POST' }).catch(() => null)
      router.push(`/notes-inbox/${intakeId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setBusy(false)
      setProgress(null)
      router.refresh()
    }
  }

  const hasFiles = staged.length > 0

  return (
    <div className="mb-8">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed text-center transition-colors ${
          dragging ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'
        } ${hasFiles ? 'px-6 py-5' : 'px-6 py-10'} ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <p className="text-sm font-medium text-gray-900">
          {hasFiles ? 'Drop more files from the same meeting' : 'Drop meeting notes here'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {ACCEPTED_LABEL}. Up to {MAX_FILES_PER_INTAKE} files, 20 MB each.
        </p>
        <button type="button" onClick={() => inputRef.current?.click()} className="btn btn-secondary mt-3 text-sm">
          Choose files
        </button>
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
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
              Not included ({rejected.length})
            </p>
            <button onClick={() => setRejected([])} className="ml-auto text-xs text-amber-800 hover:underline">
              Dismiss
            </button>
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-900">
            {rejected.map((r) => (
              <li key={r.key}>
                <span className="font-medium">{r.name}</span>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasFiles && (
        <div className="mt-3 card">
          <ul className="divide-y divide-gray-100">
            {staged.map((s) => (
              <li key={s.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-900">{s.file.name}</span>
                <span className="shrink-0 text-xs text-gray-400">{formatSize(s.file.size)}</span>
                <button
                  onClick={() => setStaged((prev) => prev.filter((x) => x.key !== s.key))}
                  disabled={busy}
                  className="shrink-0 px-1 text-lg leading-none text-gray-400 hover:text-red-600"
                  aria-label={`Remove ${s.file.name}`}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
            <button onClick={submit} disabled={busy} className="btn btn-primary">
              {busy ? progress ?? 'Working…' : `Read ${staged.length === 1 ? '1 file' : `${staged.length} files`} with Claude`}
            </button>
            {!busy && (
              <button
                onClick={() => {
                  setStaged([])
                  setRejected([])
                }}
                className="text-sm text-gray-500 hover:underline"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-gray-400">Files from one meeting go in one upload.</span>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
