import PageHeader from '@/components/PageHeader'
import { getAuthState } from '@/lib/auth'
import { listMeetings } from '@/lib/actions/meetings'
import MeetingsClient from './MeetingsClient'

// Meeting notes the whole team can read and edit. With Liveblocks configured
// (LIVEBLOCKS_SECRET_KEY) the body is co-edited live; otherwise it's a plain
// autosaving editor.
export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id: initialSelectedId } = await searchParams
  const { memberId, memberName, isAdmin } = await getAuthState()
  const liveEnabled = !!process.env.LIVEBLOCKS_SECRET_KEY

  const result = memberId ? await listMeetings(initialSelectedId) : null
  const meetings = result?.ok ? result.meetings : []

  return (
    <div>
      <PageHeader
        title="Meetings"
        description={
          liveEnabled
            ? 'Meeting notes the team can edit together in real time.'
            : 'Meeting notes the team can edit together.'
        }
      />
      {memberId ? (
        <MeetingsClient
          initialMeetings={meetings}
          me={{ memberId, name: memberName ?? 'Team member', isAdmin }}
          liveEnabled={liveEnabled}
          initialSelectedId={initialSelectedId}
        />
      ) : (
        <div className="card p-8 text-center">
          <p className="text-gray-700 font-medium">Meetings are available to active team members.</p>
        </div>
      )}
    </div>
  )
}
