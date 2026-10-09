'use client'

import { useTransition } from 'react'
import { setCategoryActive } from '@/lib/actions/expenses'
import { useToast } from '@/components/Toast'
import { unwrap } from '@/lib/actions/result'

export default function CategoryRowActions({
  categoryId,
  isActive,
}: {
  categoryId: string
  isActive: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleToggle = () => {
    startTransition(async () => {
      try {
        unwrap(await setCategoryActive(categoryId, !isActive))
        showToast(isActive ? 'Category deactivated' : 'Category activated', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Update failed', 'error')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      className="btn btn-secondary text-xs"
    >
      {isPending ? 'Saving…' : isActive ? 'Deactivate' : 'Activate'}
    </button>
  )
}
