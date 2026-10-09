'use client'

import { useTransition } from 'react'
import { generateGrantMemorandum } from '@/lib/actions/memoranda'
import { useToast } from '@/components/Toast'
import { withBasePath } from '@/lib/basePath'
import { formatDate } from '@/lib/utils/dates'
import type { GrantMemoPdf } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

export default function MemorandumPanel({
  proposalId,
  memoPdf,
  memoComplete,
  generatedByName,
}: {
  proposalId: string
  memoPdf: GrantMemoPdf | null
  memoComplete: boolean
  generatedByName: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleGenerate = () => {
    startTransition(async () => {
      try {
        unwrap(await generateGrantMemorandum(proposalId))
        showToast('Memorandum PDF generated', 'success')
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Could not generate the memorandum',
          'error'
        )
      }
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2 gap-3">
        <h3 className="font-medium text-gray-900">Memorandum PDF</h3>
        <div className="flex items-center gap-2">
          {memoPdf && (
            <a
              href={withBasePath(`/api/proposals/${proposalId}/memorandum`)}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-secondary text-xs"
            >
              Preview PDF
            </a>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isPending || !memoComplete}
            className="btn btn-primary text-xs"
          >
            {isPending ? 'Generating…' : memoPdf ? 'Regenerate' : 'Generate memorandum'}
          </button>
        </div>
      </div>

      {memoPdf ? (
        <p className="text-sm text-gray-500">
          Last generated {formatDate(memoPdf.updated_at.slice(0, 10))}
          {generatedByName ? ` by ${generatedByName}` : ''}. Regenerate after recording the
          decision, filling the Decision header line, or paying an installment — the header
          table is rebuilt from the record each time.
        </p>
      ) : memoComplete ? (
        <p className="text-sm text-gray-500">
          Renders the formal Grant Memorandum: a header table (grantee, tax status, amount, key
          dates, decision) built from the record plus the ten sections below.
        </p>
      ) : (
        <p className="text-sm text-gray-500">
          Available once all ten memorandum sections are drafted. Header fields (purpose,
          structure, decision) are optional but render as “—” until filled.
        </p>
      )}
    </div>
  )
}
