'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { syncNow } from '@/lib/actions/qbo-inbox'
import { useToast } from '@/components/Toast'
import { unwrap } from '@/lib/actions/result'

export default function SyncNowButton({ lastRunAt }: { lastRunAt: string | null }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { showToast } = useToast()

  const handleSync = () => {
    startTransition(async () => {
      try {
        const stats = unwrap(await syncNow())
        if (stats.skipped) {
          showToast(`Sync skipped: ${stats.skipped}`, 'error')
        } else if (stats.errors.length > 0) {
          showToast(`Synced with errors: ${stats.errors[0]}`, 'error')
        } else {
          showToast(
            stats.pulled === 0
              ? 'Up to date — nothing new in QuickBooks'
              : `Pulled ${stats.pulled} transaction${stats.pulled === 1 ? '' : 's'} (${stats.new} new, ${stats.auto_applied} auto-applied)`,
            'success'
          )
        }
        router.refresh()
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Sync failed', 'error')
      }
    })
  }

  return (
    <div className="flex items-center gap-3">
      {lastRunAt && (
        <span className="text-xs text-gray-400 whitespace-nowrap">
          Last synced {relative(lastRunAt)}
        </span>
      )}
      <button
        type="button"
        onClick={handleSync}
        disabled={isPending}
        className="btn btn-primary"
      >
        {isPending ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}
