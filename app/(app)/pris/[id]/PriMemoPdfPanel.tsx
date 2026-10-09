'use client'

import { useTransition } from 'react'
import { generatePriMemorandum } from '@/lib/actions/memoranda'
import { useToast } from '@/components/Toast'
import { withBasePath } from '@/lib/basePath'
import { formatDate } from '@/lib/utils/dates'
import type { PriMemoPdf } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

export default function PriMemoPdfPanel({
  priId,
  memoPdf,
  memoComplete,
  generatedByName,
}: {
  priId: string
  memoPdf: PriMemoPdf | null
  memoComplete: boolean
  generatedByName: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleGenerate = () => {
    startTransition(async () => {
      try {
        unwrap(await generatePriMemorandum(priId))
        showToast('Memo PDF generated', 'success')
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Could not generate the memo PDF',
          'error'
        )
      }
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2 gap-3">
        <h3 className="font-medium text-gray-900">Memo PDF</h3>
        <div className="flex items-center gap-2">
          {memoPdf && (
            <a
              href={withBasePath(`/api/pris/${priId}/memorandum`)}
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
            {isPending ? 'Generating…' : memoPdf ? 'Regenerate' : 'Generate memo PDF'}
          </button>
        </div>
      </div>

      {memoPdf ? (
        <p className="text-sm text-gray-500">
          Last generated {formatDate(memoPdf.updated_at.slice(0, 10))}
          {generatedByName ? ` by ${generatedByName}` : ''}. Filed under Instrument &amp;
          documents below and regenerated automatically when the PRI is funded, so the key
          dates stay current.
        </p>
      ) : memoComplete ? (
        <p className="text-sm text-gray-500">
          Renders the mission-alignment memo in the grant-memorandum format — a header table
          (recipient, instrument, amount, key dates) plus the ten answers — and files the PDF
          under Instrument &amp; documents below.
        </p>
      ) : (
        <p className="text-sm text-gray-500">
          Available once all ten memo questions are answered. Generated automatically when the
          PRI is funded.
        </p>
      )}
    </div>
  )
}
