'use client'

import { useTransition } from 'react'
import {
  acceptDisbursementMatch,
  acceptExpenseLink,
  acknowledgeItem,
  applyQboChange,
  reopenItem,
} from '@/lib/actions/qbo-inbox'
import { useToast } from '@/components/Toast'
import { unwrap, type ActionResult } from '@/lib/actions/result'

type Action = 'accept_disbursement' | 'link_expense' | 'acknowledge' | 'apply_change' | 'reopen'

const RUNNERS: Record<Action, (inboxId: string) => Promise<ActionResult>> = {
  accept_disbursement: acceptDisbursementMatch,
  link_expense: acceptExpenseLink,
  acknowledge: acknowledgeItem,
  apply_change: applyQboChange,
  reopen: reopenItem,
}

/** One-click button for suggestion/`changed`-item actions, with toast feedback. */
export default function SuggestionActions({
  inboxId,
  action,
  label,
  successMessage,
  confirmMessage,
  secondary = false,
}: {
  inboxId: string
  action: Action
  label: string
  successMessage: string
  confirmMessage?: string
  secondary?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleClick = () => {
    if (confirmMessage && !confirm(confirmMessage)) return
    startTransition(async () => {
      try {
        unwrap(await RUNNERS[action](inboxId))
        showToast(successMessage, 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Action failed', 'error')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={secondary ? 'btn btn-secondary' : 'btn btn-primary'}
    >
      {isPending ? 'Working…' : label}
    </button>
  )
}
