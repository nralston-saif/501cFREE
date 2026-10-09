'use client'

import { useContext } from 'react'
import { useFormStatus } from 'react-dom'
import { ActionFormPendingContext } from './ActionForm'

export default function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  className = 'btn btn-primary',
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
}) {
  // useFormStatus covers plain <form action>; ActionForm submits via onSubmit
  const { pending: formPending } = useFormStatus()
  const actionFormPending = useContext(ActionFormPendingContext)
  const pending = formPending || actionFormPending
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  )
}
