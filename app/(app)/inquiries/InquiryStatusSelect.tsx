'use client'

import { useState, useTransition } from 'react'
import { setInquiryStatus } from '@/lib/actions/inquiries'
import { useToast } from '@/components/Toast'
import type { DonationInquiryStatus } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

const STATUSES: DonationInquiryStatus[] = ['new', 'contacted', 'archived']

const LABELS: Record<DonationInquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  archived: 'Archived',
}

export default function InquiryStatusSelect({
  inquiryId,
  status,
}: {
  inquiryId: string
  status: DonationInquiryStatus
}) {
  const [value, setValue] = useState<DonationInquiryStatus>(status)
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleChange = (next: DonationInquiryStatus) => {
    const previous = value
    setValue(next)
    startTransition(async () => {
      try {
        unwrap(await setInquiryStatus(inquiryId, next))
        showToast('Inquiry updated', 'success')
      } catch (err) {
        setValue(previous)
        showToast(
          err instanceof Error ? err.message : 'Could not update inquiry',
          'error'
        )
      }
    })
  }

  return (
    <select
      value={value}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value as DonationInquiryStatus)}
      className="input max-w-[10rem]"
      aria-label="Inquiry status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {LABELS[s]}
        </option>
      ))}
    </select>
  )
}
