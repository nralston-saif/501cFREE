'use client'

import { useRef, useState, useTransition } from 'react'
import { deleteAttachment, getSignedFileUrl, uploadAttachment } from '@/lib/actions/attachments'
import { useToast } from '@/components/Toast'
import type { Attachment } from '@/lib/supabase/types/database'
import { formatDate } from '@/lib/utils/dates'
import { dateInTimeZone } from '@/lib/contacts/crm'
import { unwrap } from '@/lib/actions/result'

// Files kept on a contact (agreements, W-9s, reports…), in the private
// documents bucket. Opening a file uses a short-lived signed URL.

const MAX_BYTES = 10 * 1024 * 1024

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ContactDocuments({
  contactId,
  attachments,
  revalidatePath,
  timeZone,
}: {
  contactId: string
  attachments: Attachment[]
  revalidatePath: string
  /** The organization's time zone, so server and browser show the same day */
  timeZone: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, startUpload] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const { showToast } = useToast()

  const upload = (file: File) => {
    if (file.size > MAX_BYTES) {
      showToast('File is too large (max 10 MB)', 'error')
      return
    }
    const formData = new FormData()
    formData.set('entity_type', 'contact')
    formData.set('entity_id', contactId)
    formData.set('revalidate_path', revalidatePath)
    formData.set('file', file)
    startUpload(async () => {
      try {
        unwrap(await uploadAttachment(formData))
        showToast('File uploaded', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
      }
    })
  }

  const open = async (a: Attachment) => {
    setBusyId(a.id)
    try {
      window.open(unwrap(await getSignedFileUrl(a.storage_path)), '_blank', 'noopener,noreferrer')
    } catch {
      showToast('Could not open the file', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (a: Attachment) => {
    if (!confirm(`Delete "${a.file_name}"? This can't be undone.`)) return
    setBusyId(a.id)
    try {
      unwrap(await deleteAttachment(a.id, revalidatePath))
      showToast('File deleted', 'success')
    } catch {
      showToast('Delete failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn btn-primary text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Upload a document"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // allow re-selecting the same file
            if (file) upload(file)
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-gray-500">No documents yet. Upload agreements, tax forms, reports or other files.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {attachments.map((a) => (
            <li key={a.id} className="py-2.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => open(a)}
                disabled={busyId === a.id}
                className="text-sm font-medium text-gray-900 hover:underline truncate text-left disabled:opacity-50"
                title="Open in a new tab"
              >
                {a.file_name}
              </button>
              <span className="text-xs text-gray-500 flex-shrink-0">{formatSize(a.size_bytes)}</span>
              <span className="text-xs text-gray-500 flex-shrink-0 ml-auto">
                {formatDate(dateInTimeZone(a.created_at, timeZone))}
              </span>
              <button
                type="button"
                onClick={() => remove(a)}
                disabled={busyId === a.id}
                className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50 flex-shrink-0"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
