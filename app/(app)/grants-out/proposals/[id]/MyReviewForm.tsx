'use client'

import { useState, useTransition } from 'react'
import { submitReview } from '@/lib/actions/grants-out'
import { useToast } from '@/components/Toast'
import type { Vote } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

interface ExistingReview {
  score: number | null
  vote: Vote | null
  comments: string | null
  recused: boolean
}

const VOTE_OPTIONS: { value: Vote; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
]

export default function MyReviewForm({
  proposalId,
  existing,
}: {
  proposalId: string
  existing: ExistingReview | null
}) {
  const [vote, setVote] = useState<Vote | null>(existing?.vote ?? null)
  const [score, setScore] = useState(existing?.score ? String(existing.score) : '')
  const [comments, setComments] = useState(existing?.comments ?? '')
  const [recused, setRecused] = useState(existing?.recused ?? false)
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleSubmit = () => {
    const formData = new FormData()
    if (!recused) {
      if (vote) formData.set('vote', vote)
      formData.set('score', score)
    }
    formData.set('comments', comments)
    if (recused) formData.set('recused', 'on')

    startTransition(async () => {
      try {
        unwrap(await submitReview(proposalId, formData))
        showToast('Review saved', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not save review', 'error')
      }
    })
  }

  return (
    <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
      <h4 className="text-sm font-medium text-gray-900">My review</h4>

      <div>
        <span className="block text-xs font-medium text-gray-500 mb-1">Vote</span>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {VOTE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={recused || isPending}
              onClick={() => setVote(vote === option.value ? null : option.value)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                vote === option.value && !recused
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="review-score" className="block text-xs font-medium text-gray-500 mb-1">
          Score
        </label>
        <select
          id="review-score"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          disabled={recused || isPending}
          className="input disabled:opacity-50"
        >
          <option value="">No score</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>
              {n} / 5
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="review-comments" className="block text-xs font-medium text-gray-500 mb-1">
          Comments
        </label>
        <textarea
          id="review-comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={3}
          disabled={isPending}
          className="input"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={recused}
          onChange={(e) => setRecused(e.target.checked)}
          disabled={isPending}
          className="rounded border-gray-300"
        />
        Recuse myself from this proposal
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="btn btn-primary w-full"
      >
        {isPending ? 'Saving…' : 'Save my review'}
      </button>
    </div>
  )
}
