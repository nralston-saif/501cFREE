import type { TeamMember } from '@/lib/supabase/types/database'
import AddTeamMemberForm from './AddTeamMemberForm'
import TeamMemberRow from './TeamMemberRow'

// Settings > Team (the settings area is admin-only). Admins manage expenses,
// QuickBooks, the team and settings, and form the grant-review voting body;
// staff can use everything else.
export default function TeamCard({
  members,
  currentMemberId,
}: {
  members: TeamMember[]
  currentMemberId: string | null
}) {
  return (
    <div className="card p-6">
      <h2 className="font-medium text-gray-900 mb-1">Team</h2>
      <p className="text-xs text-gray-400 mb-3">
        Admins manage finances, QuickBooks, settings and the team, and vote on grant proposals.
        Staff can use everything else.
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-gray-400">No team members yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {members.map((member) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              isSelf={member.id === currentMemberId}
            />
          ))}
        </ul>
      )}

      <h3 className="font-medium text-gray-900 text-sm mt-6 mb-1">Add team member</h3>
      <p className="text-xs text-gray-400 mb-3">
        Sends them an invite email. The link signs them in and asks them to choose a password.
      </p>
      <AddTeamMemberForm />
    </div>
  )
}
