'use client'

import { useEffect } from 'react'

export default function DeleteNoteModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  notePreview,
  error,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
  notePreview?: string
  error?: string | null
}) {
  // Escape closes the modal
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, isDeleting, onClose])

  if (!isOpen) return null

  const preview = notePreview && notePreview.length > 100 ? `${notePreview.slice(0, 100)}…` : notePreview

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Delete note">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-6 pb-4 flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Delete note</h3>
            <p className="text-sm text-gray-500 mt-1">This can&apos;t be undone</p>
          </div>
        </div>

        <div className="px-6 pb-4">
          <p className="text-sm text-gray-600">
            Delete this note? It will be removed from every record it&apos;s linked to.
          </p>
          {preview && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-700 italic break-words">&ldquo;{preview}&rdquo;</p>
            </div>
          )}
          {error && <p className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3 justify-end">
          <button type="button" onClick={onClose} disabled={isDeleting} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={isDeleting} className="btn btn-danger">
            {isDeleting ? 'Deleting…' : 'Delete note'}
          </button>
        </div>
      </div>
    </div>
  )
}
