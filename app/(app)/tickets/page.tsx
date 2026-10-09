import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import CreateTicketButton from '@/components/CreateTicketButton'
import { getAuthState } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import TicketsClient, { type TicketRow } from './TicketsClient'

// Every unclosed ticket plus the 500 most recently created closed ones are
// read here and filtered/sorted client-side; writes go through
// lib/actions/tickets.ts and refresh this page.
const TICKET_SELECT = `
  id, title, description, status, priority, due_date, created_at, closed_at,
  tags, is_flagged, assigned_to, created_by, contact_id,
  assignee:team_members!assigned_to(id, full_name),
  creator:team_members!created_by(id, full_name),
  contact:contacts!contact_id(id, display_name, kind)
`

const CLOSED_TICKET_LIMIT = 500

export default async function TicketsPage() {
  const { memberId, isAdmin } = await getAuthState()
  const supabase = await createClient()

  const [active, { data: closed }, { data: members }] = await Promise.all([
    // The task list itself must be complete, however long it gets
    fetchAll<TicketRow>(() =>
      supabase
        .from('tickets')
        .select(TICKET_SELECT)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .order('id')
    ),
    supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .eq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(CLOSED_TICKET_LIMIT),
    supabase.from('team_members').select('id, full_name').eq('is_active', true).order('full_name'),
  ])

  // Newest first, as one list
  const tickets = [...active, ...((closed ?? []) as unknown as TicketRow[])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )

  return (
    <div>
      <PageHeader title="Tickets" description="The team's task list.">
        <CreateTicketButton />
      </PageHeader>
      {memberId ? (
        <TicketsClient
          tickets={tickets}
          members={members ?? []}
          currentMemberId={memberId}
          isAdmin={isAdmin}
        />
      ) : (
        <EmptyState message="Tickets are available to active team members." />
      )}
    </div>
  )
}
