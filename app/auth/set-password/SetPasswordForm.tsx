'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SubmitButton from '@/components/SubmitButton'
import { setPasswordAction, type AccountActionState } from '@/lib/actions/account'

const initialState: AccountActionState = { error: null, ok: false }

export default function SetPasswordForm({ next }: { next: string }) {
  const router = useRouter()
  const [state, formAction] = useActionState(setPasswordAction, initialState)

  useEffect(() => {
    if (state.ok) router.replace(next)
  }, [state.ok, next, router])

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="new_password" className="block text-sm font-medium text-gray-700 mb-1.5">
          New password
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={7}
          className="input"
          placeholder="At least 7 characters"
        />
      </div>
      <div>
        <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700 mb-1.5">
          New password again
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={7}
          className="input"
        />
      </div>

      {state.error && (
        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100">
          {state.error}
        </div>
      )}

      <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Saving…">
        Save password
      </SubmitButton>
      <p className="text-center text-sm">
        <Link href={next} className="text-gray-500 hover:text-gray-900">
          Skip for now
        </Link>
      </p>
    </form>
  )
}
