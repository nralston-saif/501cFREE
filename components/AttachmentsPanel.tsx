'use client'

import { useRef, useState, useTransition } from 'react'
import { uploadAttachment, deleteAttachment, getSignedFileUrl } from '@/lib/actions/attachments'
import { useToast } from './Toast'
import type { Attachment, AttachmentEntityType } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

interface AttachmentsPanelProps {
  entityType: AttachmentEntityType
  entityId: string
  attachments: Attachment[]
  revalidatePath: string
  title?: string
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function AttachmentsPanel({
  entityType,
  entityId,
  attachments,
  revalidatePath,
  title = 'Attachments',
}: AttachmentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const { showToast } = useToast()

  const handleUpload = (file: File) => {
    const formData = new FormData()
    formData.set('entity_type', entityType)
    formData.set('entity_id', entityId)
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

  const handleView = async (attachment: Attachment) => {
    setBusyId(attachment.id)
    try {
      const url = unwrap(await getSignedFileUrl(attachment.storage_path))
      window.open(url, '_blank', 'noopener')
    } catch {
      showToast('Could not open file', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = (attachment: Attachment) => {
    if (!confirm(`Delete ${attachment.file_name}?`)) return
    setBusyId(attachment.id)
    startTransition(async () => {
      try {
        unwrap(await deleteAttachment(attachment.id, revalidatePath))
        showToast('File deleted', 'success')
      } catch {
        showToast('Delete failed', 'error')
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900">{title}</h3>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
          className="btn btn-secondary text-xs"
        >
          {isPending ? 'Uploading…' : 'Upload file'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label={`Upload file to ${title}`}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleUpload(file)
            e.target.value = ''
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-gray-400">No files yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {attachments.map((a) => (
            <li key={a.id} className="py-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleView(a)}
                disabled={busyId === a.id}
                className="text-sm text-gray-700 hover:text-gray-900 hover:underline truncate text-left"
              >
                {a.file_name}
              </button>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-400">{formatSize(a.size_bytes)}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(a)}
                  disabled={busyId === a.id}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
