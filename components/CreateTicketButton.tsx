import { Suspense } from 'react'
import { getAuthState } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import CreateTicketButtonClient from './CreateTicketButtonClient'

// Server component: resolves the viewer and the assignee list, so the modal
// needs no fetch of its own. No active team member means no button.
//
// Placed inline in each page's PageHeader action row. The lookup streams in
// behind a Suspense boundary, so it never holds up the page around it (the
// page's own data and this query would otherwise run one after the other).
export default function CreateTicketButton({ className }: { className?: string }) {
  return (
    <Suspense fallback={<TicketButtonPlaceholder className={className} />}>
      <LoadedCreateTicketButton className={className} />
    </Suspense>
  )
}

async function LoadedCreateTicketButton({ className }: { className?: string }) {
  const { memberId } = await getAuthState()
  if (!memberId) return null

  const supabase = await createClient()
  const { data: assignees } = await supabase
    .from('team_members')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name')

  return (
    <CreateTicketButtonClient currentMemberId={memberId} assignees={assignees ?? []} className={className} />
  )
}

/** Same footprint as the real button, so the header doesn't shift when it arrives */
function TicketButtonPlaceholder({ className }: { className?: string }) {
  return (
    <button
      type="button"
      disabled
      aria-hidden="true"
      tabIndex={-1}
      className={`${className || 'btn btn-secondary whitespace-nowrap'} opacity-50`}
    >
      + Create Ticket
    </button>
  )
}
