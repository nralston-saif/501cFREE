'use client'

import { useActionState } from 'react'
import SubmitButton from '@/components/SubmitButton'
import { addTeamMemberAction, type TeamActionState } from '@/lib/actions/team'

const initialState: TeamActionState = { error: null, ok: false }

export default function AddTeamMemberForm() {
  const [state, formAction] = useActionState(addTeamMemberAction, initialState)

  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label htmlFor="team_full_name" className="block text-xs font-medium text-gray-600 mb-1">
          Full name *
        </label>
        <input id="team_full_name" type="text" name="full_name" required className="input" defaultValue={state.values?.full_name ?? ''} />
      </div>
      <div>
        <label htmlFor="team_email" className="block text-xs font-medium text-gray-600 mb-1">
          Email *
        </label>
        <input
          id="team_email"
          type="email"
          name="email"
          required
          className="input"
          placeholder="name@example.org"
          defaultValue={state.values?.email ?? ''}
        />
      </div>
      <div>
        <label htmlFor="team_role" className="block text-xs font-medium text-gray-600 mb-1">
          Role *
        </label>
        <select id="team_role" name="role" className="input" defaultValue={state.values?.role ?? 'staff'}>
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {state.error && (
        <div className="sm:col-span-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && !state.error && state.message && (
        <div className="sm:col-span-3 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
          {state.message}
        </div>
      )}
      <div className="sm:col-span-3">
        <SubmitButton pendingLabel="Sending invite…">Send invite</SubmitButton>
      </div>
    </form>
  )
}
