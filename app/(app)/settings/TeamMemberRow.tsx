'use client'

import { useActionState } from 'react'
import SubmitButton from '@/components/SubmitButton'
import {
  setTeamMemberActiveAction,
  setTeamMemberRoleAction,
  type TeamActionState,
} from '@/lib/actions/team'
import type { TeamMember } from '@/lib/supabase/types/database'

const initialState: TeamActionState = { error: null, ok: false }

const linkButton = 'text-xs font-medium text-gray-500 hover:text-gray-900 underline decoration-gray-300'

export default function TeamMemberRow({ member, isSelf }: { member: TeamMember; isSelf: boolean }) {
  const [roleState, roleAction] = useActionState(setTeamMemberRoleAction, initialState)
  const [activeState, activeAction] = useActionState(setTeamMemberActiveAction, initialState)
  const error = roleState.error ?? activeState.error

  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {member.full_name}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
          </p>
          <p className="text-xs text-gray-400 truncate">{member.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              member.role === 'admin' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {member.role === 'admin' ? 'Admin' : 'Staff'}
          </span>
          <form action={roleAction}>
            <input type="hidden" name="member_id" value={member.id} />
            <input type="hidden" name="role" value={member.role === 'admin' ? 'staff' : 'admin'} />
            <SubmitButton className={linkButton} pendingLabel="…">
              {member.role === 'admin' ? 'Make staff' : 'Make admin'}
            </SubmitButton>
          </form>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              member.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {member.is_active ? 'Active' : 'Inactive'}
          </span>
          {!isSelf && (
            <form action={activeAction}>
              <input type="hidden" name="member_id" value={member.id} />
              <input type="hidden" name="active" value={member.is_active ? 'false' : 'true'} />
              <SubmitButton className={linkButton} pendingLabel="…">
                {member.is_active ? 'Deactivate' : 'Activate'}
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </li>
  )
}
