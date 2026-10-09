'use client'

import { useState, useTransition } from 'react'
import { setAwardStatus } from '@/lib/actions/grants-out'
import { useToast } from '@/components/Toast'
import type { GrantOutStatus } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

const STATUSES: GrantOutStatus[] = ['awarded', 'active', 'completed', 'terminated']

export default function AwardStatusSelect({
  awardId,
  status,
}: {
  awardId: string
  status: GrantOutStatus
}) {
  const [value, setValue] = useState<GrantOutStatus>(status)
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleChange = (next: GrantOutStatus) => {
    const previous = value
    setValue(next)
    startTransition(async () => {
      try {
        unwrap(await setAwardStatus(awardId, next))
        showToast('Award status updated', 'success')
      } catch (err) {
        setValue(previous)
        showToast(err instanceof Error ? err.message : 'Could not update status', 'error')
      }
    })
  }

  return (
    <select
      value={value}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value as GrantOutStatus)}
      className="input capitalize"
      aria-label="Award status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s} className="capitalize">
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </option>
      ))}
    </select>
  )
}
