'use client'

import { useRef, useState, useTransition } from 'react'
import {
  deleteGranteeReport,
  markReportReceived,
  setGranteeReportStatus,
} from '@/lib/actions/grants-out'
import { useToast } from '@/components/Toast'
import type { GranteeReportStatus } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

export default function ReportActions({
  reportId,
  awardId,
  status,
}: {
  reportId: string
  awardId: string
  status: GranteeReportStatus
}) {
  const canMark = status === 'upcoming' || status === 'overdue'
  const [isPending, startTransition] = useTransition()
  const [marking, setMarking] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const { showToast } = useToast()

  const handleMark = () => {
    const formData = new FormData()
    if (pickedFile) formData.set('file', pickedFile)
    startTransition(async () => {
      try {
        unwrap(await markReportReceived(reportId, awardId, formData))
        showToast('Report marked received', 'success')
        setMarking(false)
        setPickedFile(null)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not mark received', 'error')
      }
    })
  }

  const handleWaive = () => {
    startTransition(async () => {
      try {
        unwrap(await setGranteeReportStatus(reportId, awardId, 'waived'))
        showToast('Report waived', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not waive report', 'error')
      }
    })
  }

  const handleDelete = () => {
    if (!confirm('Delete this report and any uploaded files? This cannot be undone.')) return
    startTransition(async () => {
      try {
        unwrap(await deleteGranteeReport(reportId, awardId))
        showToast('Report deleted', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not delete report', 'error')
      }
    })
  }

  if (marking) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
          className="text-xs text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50"
        >
          {pickedFile ? pickedFile.name : '+ Attach file (optional)'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Attach report file"
          className="hidden"
          onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={handleMark}
          disabled={isPending}
          className="text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMarking(false)
            setPickedFile(null)
          }}
          disabled={isPending}
          className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-3">
      {canMark && (
        <button
          type="button"
          onClick={() => setMarking(true)}
          disabled={isPending}
          className="text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-50"
        >
          Mark received
        </button>
      )}
      {canMark && (
        <button
          type="button"
          onClick={handleWaive}
          disabled={isPending}
          className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-50"
        >
          Waive
        </button>
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  )
}
