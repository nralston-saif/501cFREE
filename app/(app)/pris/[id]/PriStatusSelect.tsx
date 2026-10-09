'use client'

import { useState, useTransition } from 'react'
import { setPriStatus } from '@/lib/actions/pris'
import { useToast } from '@/components/Toast'
import type { PriStatus } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

// 'committed' is not offered: funding happens through Mark funded (which
// checks the compliance file), and a funded PRI can't return to committed.
const STATUSES = [
  'funded',
  'converted',
  'repaid',
  'exited',
  'written_off',
] as const satisfies readonly PriStatus[]

const LABELS: Record<(typeof STATUSES)[number], string> = {
  funded: 'Funded',
  converted: 'Converted',
  repaid: 'Repaid',
  exited: 'Exited',
  written_off: 'Written off',
}

export default function PriStatusSelect({
  priId,
  status,
}: {
  priId: string
  status: PriStatus
}) {
  const [value, setValue] = useState<PriStatus>(status)
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleChange = (next: PriStatus) => {
    const previous = value
    setValue(next)
    startTransition(async () => {
      try {
        unwrap(await setPriStatus(priId, next))
        showToast('PRI status updated', 'success')
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
      onChange={(e) => handleChange(e.target.value as PriStatus)}
      className="input"
      aria-label="PRI status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {LABELS[s]}
        </option>
      ))}
    </select>
  )
}
