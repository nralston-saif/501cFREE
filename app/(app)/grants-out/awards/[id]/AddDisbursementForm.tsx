'use client'

import { useState } from 'react'
import MoneyInput from '@/components/MoneyInput'
import SubmitButton from '@/components/SubmitButton'
import { addDisbursement } from '@/lib/actions/grants-out'
import { formatCents, parseDollarsToCents } from '@/lib/utils/money'
import ActionForm from '@/components/ActionForm'

interface AddDisbursementFormProps {
  awardId: string
  awardedCents: number
  /** Total of scheduled + paid disbursements already on this award (cents). */
  committedCents: number
}

export default function AddDisbursementForm({
  awardId,
  awardedCents,
  committedCents,
}: AddDisbursementFormProps) {
  const [amount, setAmount] = useState('')

  const parsed = parseDollarsToCents(amount)
  const wouldExceed = parsed !== null && committedCents + parsed > awardedCents
  const overBy = wouldExceed ? committedCents + parsed - awardedCents : 0
  const remaining = Math.max(0, awardedCents - committedCents)

  // The amount is controlled, so the form reset after a successful add doesn't
  // clear it (or the over-award warning computed from it): clear it here.
  return (
    <ActionForm
      action={addDisbursement.bind(null, awardId)}
      onSuccess={() => setAmount('')}
      className="border-t border-gray-100 pt-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <label htmlFor="disbursement_amount" className="block text-xs font-medium text-gray-500 mb-1">
            Amount *
          </label>
          <MoneyInput id="disbursement_amount" name="amount" required value={amount} onChange={setAmount} />
        </div>
        <div>
          <label
            htmlFor="scheduled_date"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Scheduled date
          </label>
          <input id="scheduled_date" name="scheduled_date" type="date" className="input" />
        </div>
        <div>
          <label htmlFor="method" className="block text-xs font-medium text-gray-500 mb-1">
            Method
          </label>
          <select id="method" name="method" defaultValue="" className="input">
            <option value="">—</option>
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="wire">Wire</option>
          </select>
        </div>
        <SubmitButton pendingLabel="Adding…" className="btn btn-secondary">
          Add disbursement
        </SubmitButton>
      </div>

      {wouldExceed && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This would put scheduled + paid disbursements{' '}
          <span className="font-medium tabular-nums">{formatCents(overBy)}</span> over the
          awarded amount ({formatCents(remaining)} remaining before this entry). You can still
          add it if that&rsquo;s intentional.
        </div>
      )}
    </ActionForm>
  )
}
