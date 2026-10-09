'use client'

import { useRef, useState, useTransition } from 'react'
import {
  deleteAttachment,
  getSignedFileUrl,
  uploadAttachment,
} from '@/lib/actions/attachments'
import { useToast } from '@/components/Toast'
import type { Attachment } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

/**
 * File chips shown in the Files column of the grantee reports table.
 * Each chip opens the file in a new tab; the "×" deletes the attachment.
 * A trailing "+ Add" button picks another file to upload at any time —
 * regardless of the report's current status — since the grantee can send
 * documents before, during, or after the report is marked received.
 */
export default function ReportFileChips({
  reportId,
  awardId,
  attachments,
}: {
  reportId: string
  awardId: string
  attachments: Attachment[]
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()
  const revalidatePath = `/grants-out/awards/${awardId}`

  const handleUpload = (file: File) => {
    const formData = new FormData()
    formData.set('entity_type', 'grantee_report')
    formData.set('entity_id', reportId)
    formData.set('revalidate_path', revalidatePath)
    formData.set('file', file)
    startTransition(async () => {
      try {
        unwrap(await uploadAttachment(formData))
        showToast('File uploaded', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
      }
    })
  }

  const handleView = async (a: Attachment) => {
    setBusyId(a.id)
    try {
      const url = unwrap(await getSignedFileUrl(a.storage_path))
      window.open(url, '_blank', 'noopener')
    } catch {
      showToast('Could not open file', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = (a: Attachment) => {
    if (!confirm(`Delete ${a.file_name}?`)) return
    setBusyId(a.id)
    startTransition(async () => {
      try {
        unwrap(await deleteAttachment(a.id, revalidatePath))
        showToast('File deleted', 'success')
      } catch {
        showToast('Delete failed', 'error')
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {attachments.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-xs"
        >
          <button
            type="button"
            onClick={() => handleView(a)}
            disabled={busyId === a.id}
            className="text-gray-700 hover:text-gray-900 hover:underline truncate max-w-[12rem]"
          >
            {a.file_name}
          </button>
          <button
            type="button"
            onClick={() => handleDelete(a)}
            disabled={busyId === a.id}
            className="text-gray-400 hover:text-red-600"
            aria-label={`Delete ${a.file_name}`}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isPending}
        className="text-xs text-gray-500 hover:text-gray-900 hover:underline disabled:opacity-50"
      >
        {isPending ? 'Uploading…' : '+ Add'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Add report file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleUpload(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
