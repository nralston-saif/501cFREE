'use client'

import { useTransition } from 'react'
import { deleteExpense } from '@/lib/actions/expenses'
import { useToast } from '@/components/Toast'
import { unwrap } from '@/lib/actions/result'

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT'))
  )
}

export default function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleDelete = () => {
    if (!confirm('Delete this expense? This cannot be undone.')) return
    startTransition(async () => {
      try {
        unwrap(await deleteExpense(expenseId))
      } catch (err) {
        if (isNextRedirect(err)) throw err
        showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      className="btn btn-danger"
    >
      {isPending ? 'Deleting…' : 'Delete expense'}
    </button>
  )
}
