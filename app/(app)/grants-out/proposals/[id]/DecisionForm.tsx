'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { recordDecision } from '@/lib/actions/grants-out'
import { useToast } from '@/components/Toast'
import MoneyInput from '@/components/MoneyInput'
import type { ProposalDecision } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

export default function DecisionForm({
  proposalId,
  requestedAmount,
  finishApproval = false,
  canCreateAward,
}: {
  proposalId: string
  /** Requested amount as a dollar string (may be empty) to prefill the award amount. */
  requestedAmount: string
  /**
   * The proposal is already approved but has no award (an earlier award
   * insert failed): only ask for the amount and create the award.
   */
  finishApproval?: boolean
  /** Admins make the award on approval; other reviewers only record the decision */
  canCreateAward: boolean
}) {
  const [decision, setDecision] = useState<ProposalDecision | null>(
    finishApproval ? 'approved' : null
  )
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!decision) return
    const message =
      finishApproval
        ? 'Create the award for this approved proposal?'
        : decision === 'approved'
        ? canCreateAward
          ? 'Approve this proposal? An award will be created.'
          : 'Approve this proposal? An admin then creates the award.'
        : 'Decline this proposal?'
    if (!confirm(message)) return

    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        unwrap(await recordDecision(proposalId, formData))
        showToast('Decision recorded', 'success')
      } catch (err) {
        if ((err as Error & { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
        showToast(err instanceof Error ? err.message : 'Could not record decision', 'error')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {finishApproval ? (
        <input type="hidden" name="decision" value="approved" />
      ) : (
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="decision"
            value="approved"
            required
            checked={decision === 'approved'}
            onChange={() => setDecision('approved')}
          />
          Approve
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="decision"
            value="declined"
            checked={decision === 'declined'}
            onChange={() => setDecision('declined')}
          />
          Decline
        </label>
      </div>
      )}

      {decision === 'approved' && !canCreateAward && (
        <p className="text-xs text-gray-500">An admin creates the award and sets its amount.</p>
      )}

      {decision === 'approved' && canCreateAward && (
        <div>
          <label htmlFor="amount_awarded" className="block text-xs font-medium text-gray-500 mb-1">
            Amount awarded
          </label>
          <MoneyInput
            id="amount_awarded"
            name="amount_awarded"
            defaultValue={requestedAmount}
            required={requestedAmount === ''}
          />
        </div>
      )}

      {!finishApproval && (
      <div>
        <label htmlFor="decision_notes" className="block text-xs font-medium text-gray-500 mb-1">
          Decision notes
        </label>
        <textarea id="decision_notes" name="decision_notes" rows={3} className="input" />
      </div>
      )}

      <button
        type="submit"
        disabled={isPending || !decision}
        className="btn btn-primary w-full"
      >
        {isPending ? 'Recording…' : finishApproval ? 'Create award' : 'Record decision'}
      </button>
    </form>
  )
}
