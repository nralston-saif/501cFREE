import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import PageHeader from '@/components/PageHeader'
import { formatCents } from '@/lib/utils/money'
import { formatDate, daysUntil, msSince, todayInTimeZone } from '@/lib/utils/dates'
import { getOrgSettings } from '@/lib/settings'
import { isVotingMember } from '@/lib/grants/voting'
import { currentFiscalYear, fiscalYearRange } from '@/lib/utils/fiscal-year'
import CreateTicketButton from '@/components/CreateTicketButton'

interface AgendaItem {
  key: string
  label: string
  detail: string
  date: string
  href: string
}

/** YYYY-MM-DD `days` days after a YYYY-MM-DD date */
function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function DaysChip({ date }: { date: string }) {
  const days = daysUntil(date)
  const overdue = days < 0
  const label = overdue ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {label}
    </span>
  )
}

type NamedContact = { display_name: string } | null

export default async function DashboardPage() {
  const supabase = await createClient()

  // Everything that needs the fiscal year or "today" waits for the settings
  // row; everything else starts at once. Names come from FK embeds, so
  // there's no second wave of lookups.
  const settingsP = getOrgSettings(supabase)
  const datedP = settingsP.then((settings) => {
    const startMonth = settings.fiscal_year_start_month
    const fy = currentFiscalYear(startMonth, settings.timezone)
    const { start, end } = fiscalYearRange(fy, startMonth)
    const horizon = addDaysISO(todayInTimeZone(settings.timezone), 30)
    return Promise.all([
      // Summed in SQL (0010_summaries.sql): a whole year of rows would
      // overflow PostgREST's max_rows and undercount
      supabase.rpc('fiscal_year_totals', { p_start: start, p_end: end }),
      supabase
        .from('disbursements')
        .select(
          'id, grant_out_id, amount_cents, scheduled_date, grant:grants_out!grant_out_id(grantee:contacts!grantee_contact_id(display_name))'
        )
        .eq('status', 'scheduled')
        .not('scheduled_date', 'is', null)
        .lte('scheduled_date', horizon)
        .order('scheduled_date'),
      supabase
        .from('grantee_reports')
        .select(
          'id, grant_out_id, report_type, due_date, grant:grants_out!grant_out_id(grantee:contacts!grantee_contact_id(display_name))'
        )
        .in('status', ['upcoming', 'overdue'])
        .lte('due_date', horizon)
        .order('due_date'),
    ]).then((results) => ({ fy, start, results }))
  })

  const [
    settings,
    { fy, start, results: [fyTotalsRes, scheduledDisbursementsRes, granteeReportsRes] },
    authState,
    activeGrantsRes,
    proposalsRes,
    recentContributionsRes,
    recentExpensesRes,
    qboInboxRes,
    qboSyncStateRes,
  ] = await Promise.all([
    settingsP,
    datedP,
    // Cached per request — shares the layout's auth + member lookup
    getAuthState(),
    supabase
      .from('grants_out')
      .select('id', { count: 'exact', head: true })
      .in('status', ['awarded', 'active']),
    // Open proposals with the reviews this member can see (always their own)
    supabase
      .from('grant_proposals')
      .select('id, title, reviews:proposal_reviews!proposal_id(reviewer_id)')
      .in('status', ['received', 'in_review', 'diligence'])
      .order('created_at'),
    supabase
      .from('contributions')
      .select('id, contact_id, amount_cents, received_date, contact:contacts!contact_id(display_name)')
      .order('received_date', { ascending: false })
      .limit(5),
    supabase
      .from('expenses')
      .select('id, description, amount_cents, expense_date')
      .order('expense_date', { ascending: false })
      .limit(5),
    supabase
      .from('qbo_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase.from('qbo_sync_state').select('pull_enabled, last_run_at').eq('id', 1).maybeSingle(),
  ])

  const memberId = authState.memberId

  // Stat card totals
  const fyTotals = fyTotalsRes.data?.[0]
  const fyContributionsTotal = fyTotals?.contributions_cents ?? 0
  const fyExpensesTotal = fyTotals?.expenses_cents ?? 0
  const fyGrantsPaidTotal = fyTotals?.grants_paid_cents ?? 0
  const activeGrantsCount = activeGrantsRes.count ?? 0

  // Proposals awaiting this member's review, for members of the voting body
  // (org_settings.grant_review_mode; RLS on proposal_reviews enforces it)
  const isVoter = Boolean(
    authState.memberRole && isVotingMember({ role: authState.memberRole }, settings.grant_review_mode)
  )
  // Embedded selects are untyped (see lib/supabase/types/database.ts)
  const proposals = (proposalsRes.data ?? []) as unknown as {
    id: string
    title: string
    reviews: { reviewer_id: string }[] | null
  }[]
  const needsVote = proposals.filter(
    (p) =>
      isVoter &&
      memberId !== null &&
      !(p.reviews ?? []).some((r) => r.reviewer_id === memberId)
  )

  type GranteeEmbed = { grant: { grantee: NamedContact } | null }
  const scheduledDisbursements = (scheduledDisbursementsRes.data ?? []) as unknown as ({
    id: string
    grant_out_id: string
    amount_cents: number
    scheduled_date: string | null
  } & GranteeEmbed)[]
  const granteeReports = (granteeReportsRes.data ?? []) as unknown as ({
    id: string
    grant_out_id: string
    report_type: string
    due_date: string
  } & GranteeEmbed)[]
  const recentContributions = (recentContributionsRes.data ?? []) as unknown as {
    id: string
    contact_id: string
    amount_cents: number | null
    received_date: string
    contact: NamedContact
  }[]
  const granteeName = (row: GranteeEmbed) => row.grant?.grantee?.display_name ?? 'Unknown grantee'

  const agenda: AgendaItem[] = [
    ...scheduledDisbursements
      .filter((d): d is typeof d & { scheduled_date: string } => d.scheduled_date !== null)
      .map((d) => ({
        key: `disbursement-${d.id}`,
        label: `Disbursement · ${formatCents(d.amount_cents)}`,
        detail: granteeName(d),
        date: d.scheduled_date,
        href: `/grants-out/awards/${d.grant_out_id}`,
      })),
    ...granteeReports.map((r) => ({
      key: `report-${r.id}`,
      label: `Grantee ${r.report_type} report due`,
      detail: granteeName(r),
      date: r.due_date,
      href: `/grants-out/awards/${r.grant_out_id}`,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const stats = [
    { label: `FY${fy} contributions`, value: formatCents(fyContributionsTotal) },
    { label: `FY${fy} expenses`, value: formatCents(fyExpensesTotal) },
    { label: `FY${fy} grants paid`, value: formatCents(fyGrantsPaidTotal) },
    { label: 'Active grants', value: String(activeGrantsCount) },
  ]

  const qboPendingCount = qboInboxRes.count ?? 0
  const qboSyncState = qboSyncStateRes.data
  const qboSyncStale =
    qboSyncState?.pull_enabled === true &&
    (!qboSyncState.last_run_at ||
      msSince(qboSyncState.last_run_at) > 24 * 60 * 60 * 1000)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Fiscal year ${fy} · ${formatDate(start)} onward`}
      >
        <CreateTicketButton />
      </PageHeader>

      {qboPendingCount > 0 && (
        <Link
          href="/banking"
          className="card p-4 mb-6 flex items-center justify-between gap-3 border-blue-100 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          <span className="text-sm text-blue-900 font-medium">
            {qboPendingCount} bank transaction{qboPendingCount === 1 ? '' : 's'} from QuickBooks to
            review
          </span>
          <span className="text-sm text-blue-700">Review →</span>
        </Link>
      )}
      {qboSyncStale && (
        <div className="card p-4 mb-6 border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          The QuickBooks pull sync hasn&rsquo;t run in over 24 hours. Check that the scheduled
          job calling /api/cron/qbo-pull is running.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{stat.label}</p>
            <p className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-1 gap-6 mb-6 ${isVoter ? 'lg:grid-cols-2' : ''}`}>
        {isVoter && (
        <div className="card p-5">
          <h2 className="font-medium text-gray-900 mb-3">Needs your vote</h2>
          {needsVote.length === 0 ? (
            <p className="text-sm text-gray-400">No proposals waiting on your review.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {needsVote.map((proposal) => (
                <li key={proposal.id} className="py-2.5">
                  <Link
                    href={`/grants-out/proposals/${proposal.id}`}
                    className="text-sm font-medium text-gray-900 hover:underline"
                  >
                    {proposal.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}

        <div className="card p-5">
          <h2 className="font-medium text-gray-900 mb-3">Upcoming &amp; overdue</h2>
          {agenda.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing due in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {agenda.map((item) => (
                <li key={item.key} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={item.href}
                      className="block text-sm font-medium text-gray-900 hover:underline truncate"
                    >
                      {item.label}
                    </Link>
                    <span className="block text-xs text-gray-400 truncate">{item.detail}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500">{formatDate(item.date)}</span>
                    <DaysChip date={item.date} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-medium text-gray-900 mb-3">Recent contributions</h2>
          {recentContributions.length === 0 ? (
            <p className="text-sm text-gray-400">No contributions yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentContributions.map((c) => (
                <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-900 truncate">
                    {c.contact?.display_name ?? 'Unknown donor'}
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-500 text-xs">{formatDate(c.received_date)}</span>
                    <span className="tabular-nums font-medium">
                      {formatCents(c.amount_cents)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-medium text-gray-900 mb-3">Recent expenses</h2>
          {(recentExpensesRes.data ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">No expenses yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(recentExpensesRes.data ?? []).map((e) => (
                <li key={e.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-900 truncate">{e.description}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-500 text-xs">{formatDate(e.expense_date)}</span>
                    <span className="tabular-nums font-medium">{formatCents(e.amount_cents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
