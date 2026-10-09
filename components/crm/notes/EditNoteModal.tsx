'use client'

import { useEffect, useState } from 'react'
import RichTextEditor from './LazyRichTextEditor'
import { linkKey, noteToEditorHtml, type NoteLinkChip } from './types'

export type EditableNoteLink = NoteLinkChip & { isPrimary: boolean }

/**
 * Edit a saved note: date, body and which records it's linked to (the
 * primary link, the record it was written on, always stays).
 */
export default function EditNoteModal({
  onClose,
  onSave,
  isSaving,
  initialContent,
  initialDate,
  initialLinks,
  error,
}: {
  onClose: () => void
  onSave: (content: string, noteDate: string, links: EditableNoteLink[]) => void
  isSaving: boolean
  initialContent: string
  initialDate: string
  initialLinks: EditableNoteLink[]
  error?: string | null
}) {
  const [initialHtml] = useState(() => noteToEditorHtml(initialContent))
  const [content, setContent] = useState(initialHtml)
  const [noteDate, setNoteDate] = useState(initialDate)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  // Escape closes the modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSaving, onClose])

  const keyOf = (l: EditableNoteLink) => linkKey(l.entityType, l.entityId)
  const remaining = initialLinks.filter((l) => !removed.has(keyOf(l)))
  const hasChanges = content !== initialHtml || noteDate !== initialDate || removed.size > 0
  const toggle = (l: EditableNoteLink) =>
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(keyOf(l))) next.delete(keyOf(l))
      else next.add(keyOf(l))
      return next
    })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Edit note">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !isSaving && onClose()} />
      <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="p-6 pb-4 flex-shrink-0 flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Edit note</h3>
            <p className="text-sm text-gray-500 mt-1">Update the note&apos;s content, date and links</p>
          </div>
        </div>

        <div className="px-6 pb-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Date</span>
            <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="input" />
          </label>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Note</span>
            <RichTextEditor initialContent={initialHtml} onChange={setContent} ariaLabel="Note content" />
          </div>

          {initialLinks.length > 0 && (
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">Linked to</span>
              <div className="flex flex-wrap gap-1.5">
                {initialLinks.map((l) =>
                  l.isPrimary ? (
                    <span
                      key={keyOf(l)}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                      title="The record this note was written on — always linked"
                    >
                      {l.label}
                    </span>
                  ) : removed.has(keyOf(l)) ? (
                    <button
                      key={keyOf(l)}
                      type="button"
                      onClick={() => toggle(l)}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white text-gray-400 border border-dashed border-gray-300 hover:text-blue-600 hover:border-blue-300"
                      title={`Link this note to ${l.label} again`}
                    >
                      + {l.label}
                    </button>
                  ) : (
                    <span
                      key={keyOf(l)}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                    >
                      {l.label}
                      <button
                        type="button"
                        onClick={() => toggle(l)}
                        className="ml-0.5 px-1 text-blue-300 hover:text-blue-600"
                        aria-label={`Remove link to ${l.label}`}
                      >
                        ✕
                      </button>
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {error && <p className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3 justify-end flex-shrink-0">
          <button type="button" onClick={onClose} disabled={isSaving} className="btn btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(content, noteDate, remaining)}
            disabled={isSaving || !content.trim() || !hasChanges}
            className="btn btn-primary"
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
