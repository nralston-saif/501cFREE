'use client'

import { useState, useTransition } from 'react'
import { advanceToDiligence, declineAtReview } from '@/lib/actions/grants-out'
import { useToast } from '@/components/Toast'
import { unwrap } from '@/lib/actions/result'

/**
 * Shown once votes are revealed on an in_review proposal: the reviewers either
 * advance it into diligence or decline it (which queues the response email).
 */
export default function AdvanceDeclinePanel({
  proposalId,
  hasContact,
}: {
  proposalId: string
  /** Advancing requires a linked applicant contact; the button explains why. */
  hasContact: boolean
}) {
  const [declining, setDeclining] = useState(false)
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleAdvance = () => {
    startTransition(async () => {
      try {
        unwrap(await advanceToDiligence(proposalId))
        showToast('Moved to diligence', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not advance', 'error')
      }
    })
  }

  const handleDecline = () => {
    const formData = new FormData()
    formData.set('decision_notes', notes)
    startTransition(async () => {
      try {
        unwrap(await declineAtReview(proposalId, formData))
        showToast('Proposal declined', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not decline', 'error')
      }
    })
  }

  return (
    <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
      <h4 className="text-sm font-medium text-gray-900">Next step</h4>

      {!declining ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleAdvance}
            disabled={isPending || !hasContact}
            className="btn btn-primary w-full"
          >
            {isPending ? 'Working…' : 'Advance to diligence'}
          </button>
          {!hasContact && (
            <p className="text-xs text-gray-500">
              Link an applicant contact above before advancing.
            </p>
          )}
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={isPending}
            className="btn btn-secondary w-full"
          >
            Decline…
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="decline-notes" className="block text-xs font-medium text-gray-500">
            Decision notes (internal)
          </label>
          <textarea
            id="decline-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            disabled={isPending}
            placeholder="Why this is a pass — feeds the AI-drafted response email."
            className="input"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDecline}
              disabled={isPending}
              className="btn btn-primary flex-1"
            >
              {isPending ? 'Declining…' : 'Decline proposal'}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              disabled={isPending}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
