import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import { formatTimestamp } from '@/lib/utils/dates'
import { getOrgSettings } from '@/lib/settings'
import type { AuditEvent, TeamMember } from '@/lib/supabase/types/database'

// Admin-only team activity stream (gated by ../layout.tsx; audit_log RLS is
// admin-only too). Every team-member write to a tracked table is logged by a
// database trigger as "<table>:<op>", plus sign-ins and sign-outs, newest
// first. Filter by role or individual member. Consecutive identical events
// (e.g. a meeting's 2s auto-saves) collapse into one row with a count.

export const dynamic = 'force-dynamic'

type Row = {
  at: string
  memberId: string | null
  email: string
  role: string | null
  event: string
  detail: string | null
  count: number
}

const EVENT_LABELS: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
}

// Tables whose rows have a readable name to show in the Detail column
const NAMED_TABLES: Record<string, { column: string; label: (row: Record<string, string | null>) => string | null }> = {
  contacts: { column: 'id, display_name', label: (r) => r.display_name },
  meetings: { column: 'id, title', label: (r) => r.title },
  tickets: { column: 'id, title', label: (r) => r.title },
  grant_proposals: { column: 'id, title', label: (r) => r.title },
  expenses: { column: 'id, description', label: (r) => r.description },
}

// Trigger events look like "contacts:insert" / "contributions:update"
function labelForEvent(eventType: string): string {
  if (EVENT_LABELS[eventType]) return EVENT_LABELS[eventType]
  const [table, op] = eventType.split(':')
  if (!op) return eventType
  const noun = table.replace(/_/g, ' ')
  const verb = op === 'insert' ? 'Created' : op === 'update' ? 'Updated' : 'Deleted'
  return `${verb} ${noun}`
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; role?: string }>
}) {
  const { member: memberFilter, role: roleFilter } = await searchParams
  const supabase = await createClient()
  const { timezone } = await getOrgSettings(supabase)

  let eventsQuery = supabase
    .from('audit_log')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(600)
  if (memberFilter) eventsQuery = eventsQuery.eq('actor_member_id', memberFilter)
  else if (roleFilter === 'admin' || roleFilter === 'staff') eventsQuery = eventsQuery.eq('actor_role', roleFilter)

  const [{ data: eventRows }, { data: memberRows }] = await Promise.all([
    eventsQuery,
    supabase.from('team_members').select('id, email, full_name, role').order('full_name'),
  ])
  const events = (eventRows ?? []) as AuditEvent[]
  const members = (memberRows ?? []) as Pick<TeamMember, 'id' | 'email' | 'full_name' | 'role'>[]
  const memberById = new Map(members.map((m) => [m.id, m]))

  // Resolve record names so rows read "Updated contacts — Acme Foundation".
  // Deleted records no longer resolve and show no detail.
  const idsByTable = new Map<string, Set<string>>()
  for (const e of events) {
    if (!e.entity_type || !e.entity_id || !NAMED_TABLES[e.entity_type]) continue
    const set = idsByTable.get(e.entity_type) ?? new Set<string>()
    set.add(e.entity_id)
    idsByTable.set(e.entity_type, set)
  }
  const nameById = new Map<string, string>()
  await Promise.all(
    [...idsByTable].map(async ([table, ids]) => {
      const spec = NAMED_TABLES[table]
      const { data } = await supabase
        .from(table as 'contacts')
        .select(spec.column)
        .in('id', [...ids])
      for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
        const label = spec.label(row)
        if (row.id && label) nameById.set(row.id, label)
      }
    })
  )

  const merged = events.map((e) => ({
    at: e.occurred_at,
    memberId: e.actor_member_id,
    email: e.actor_email ?? '',
    role: e.actor_role,
    event: labelForEvent(e.event_type),
    detail: e.summary ?? (e.entity_id ? (nameById.get(e.entity_id) ?? null) : null),
  }))

  // Collapse consecutive identical events (auto-save bursts) into one row
  const rows: Row[] = []
  for (const r of merged) {
    const last = rows[rows.length - 1]
    if (last && last.memberId === r.memberId && last.event === r.event && last.detail === r.detail) {
      last.count += 1
    } else {
      rows.push({ ...r, count: 1 })
    }
    if (rows.length >= 300) break
  }

  const chip = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`px-2.5 py-1 rounded-lg ${active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}`}
    >
      {label}
    </Link>
  )

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Team activity"
        description="Sign-ins and changes by admins and staff"
      />

      <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
        {chip('/settings/activity', 'Everyone', !memberFilter && !roleFilter)}
        {chip('/settings/activity?role=admin', 'Admins', !memberFilter && roleFilter === 'admin')}
        {chip('/settings/activity?role=staff', 'Staff', !memberFilter && roleFilter === 'staff')}
        <Link href="/settings" className="ml-auto text-gray-400 hover:text-gray-900">
          ← Settings
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        {members.map((m) => chip(`/settings/activity?member=${m.id}`, m.full_name, memberFilter === m.id))}
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">
            No activity recorded yet for this filter. Events appear as team members log in and
            make changes.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">What</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {formatTimestamp(r.at, timezone)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className="text-gray-900">
                      {(r.memberId && memberById.get(r.memberId)?.full_name) || r.email || 'Unknown'}
                    </span>
                    {r.role === 'staff' && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-xs font-medium">
                        staff
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-900">
                    {r.event}
                    {r.count > 1 && <span className="ml-1.5 text-xs text-gray-400">×{r.count}</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-400">{r.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
