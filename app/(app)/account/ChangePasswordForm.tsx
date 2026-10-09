'use client'

import { useActionState } from 'react'
import SubmitButton from '@/components/SubmitButton'
import { changePasswordAction, type AccountActionState } from '@/lib/actions/account'

const initialState: AccountActionState = { error: null, ok: false }

// All three fields are deliberately visible text (a product decision): these are
// shared-office password changes, and seeing the value beats typos.
export default function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState)

  return (
    <form action={formAction} className="card p-6 max-w-md space-y-4">
      <div>
        <h2 className="font-medium text-gray-900">Change password</h2>
        <p className="text-xs text-gray-400 mt-1">
          Used for signing in to this site. At least 7 characters.
        </p>
      </div>

      <div>
        <label htmlFor="current_password" className="block text-xs font-medium text-gray-600 mb-1">
          Current password *
        </label>
        <input id="current_password" type="text" name="current_password" required autoComplete="off" className="input" />
      </div>
      <div>
        <label htmlFor="new_password" className="block text-xs font-medium text-gray-600 mb-1">
          New password *
        </label>
        <input id="new_password" type="text" name="new_password" required minLength={7} autoComplete="off" className="input" />
      </div>
      <div>
        <label htmlFor="confirm_password" className="block text-xs font-medium text-gray-600 mb-1">
          New password again *
        </label>
        <input id="confirm_password" type="text" name="confirm_password" required minLength={7} autoComplete="off" className="input" />
      </div>

      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && !state.error && (
        <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
          Password changed — use it the next time you sign in.
        </div>
      )}

      <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
    </form>
  )
}
