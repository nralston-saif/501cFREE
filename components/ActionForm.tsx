'use client'

import { createContext, useTransition, type FormEvent, type FormHTMLAttributes } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { useToast } from '@/components/Toast'
import type { ActionResult } from '@/lib/actions/result'

/** Lets SubmitButton show its pending label inside an ActionForm. */
export const ActionFormPendingContext = createContext(false)

type ActionFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit'> & {
  /** A server action returning an ActionResult (bound arguments are fine). */
  action: (formData: FormData) => Promise<ActionResult<unknown>>
  /** Toast shown after a successful submit. */
  successMessage?: string
  /** Called after a successful submit (e.g. to clear controlled inputs). */
  onSuccess?: () => void
}

/**
 * <form> for a server action that returns an ActionResult. Shows the action's
 * error as a toast and keeps the user's input; on success it resets the form
 * like a plain <form action> would. Actions that redirect still navigate.
 */
export default function ActionForm({
  action,
  successMessage,
  onSuccess,
  children,
  ...formProps
}: ActionFormProps) {
  const [pending, startTransition] = useTransition()
  const { showToast } = useToast()

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pending) return
    const form = e.currentTarget
    const submitter = (e.nativeEvent as SubmitEvent).submitter
    const formData = new FormData(form, submitter)
    startTransition(async () => {
      let result: ActionResult<unknown>
      try {
        result = await action(formData)
      } catch (err) {
        unstable_rethrow(err) // redirect() on success
        showToast('Something went wrong. Please try again.', 'error')
        return
      }
      if (!result.ok) {
        showToast(result.error, 'error')
        return
      }
      form.reset()
      onSuccess?.()
      if (successMessage) showToast(successMessage, 'success')
    })
  }

  return (
    <form {...formProps} onSubmit={handleSubmit} aria-busy={pending || undefined}>
      <ActionFormPendingContext.Provider value={pending}>{children}</ActionFormPendingContext.Provider>
    </form>
  )
}
