import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import SyncNowButton from './SyncNowButton'
import InboxRow from './InboxRow'
import type { QboInboxItem, QboInboxStatus } from '@/lib/supabase/types/database'
import CreateTicketButton from '@/components/CreateTicketButton'
import { msSince } from '@/lib/utils/dates'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import QuickBooksDemoNote from '@/components/QuickBooksDemoNote'

type Tab = 'review' | 'auto' | 'done' | 'echo'

const TABS: { key: Tab; label: string; statuses: QboInboxStatus[] }[] = [
  { key: 'review', label: 'Needs review', statuses: ['pending'] },
  { key: 'auto', label: 'Auto-applied', statuses: ['auto_applied'] },
  { key: 'done', label: 'Done', statuses: ['approved', 'dismissed'] },
  { key: 'echo', label: 'Synced from this app', statuses: ['echo'] },
]

export default async function BankingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: tabParam } = await searchParams
  const tab: Tab = (TABS.find((t) => t.key === tabParam)?.key ?? 'review') as Tab
  const supabase = await createClient()

  const activeStatuses = (TABS.find((t) => t.key === tab) as (typeof TABS)[number]).statuses

  // Tab badges are head-only counts; only the active tab's rows are loaded
  // (every one of them, past max_rows).
  const [
    visible,
    tabCounts,
    { data: syncState },
    { data: connection },
    { data: categories },
    allContacts,
    { data: teamMembers },
  ] = await Promise.all([
    fetchAll<QboInboxItem>(() =>
      supabase
        .from('qbo_inbox')
        .select('*')
        .in('status', activeStatuses)
        .order('txn_date', { ascending: false, nullsFirst: false })
        .order('first_seen_at', { ascending: false })
        .order('id')
    ),
    Promise.all(
      TABS.map(async (t) => {
        const { count, error } = await supabase
          .from('qbo_inbox')
          .select('id', { count: 'exact', head: true })
          .in('status', t.statuses)
        if (error) throw new Error(`Could not count inbox items: ${error.message}`)
        return [t.key, count ?? 0] as const
      })
    ),
    supabase.from('qbo_sync_state').select('*').eq('id', 1).maybeSingle(),
    supabase.from('qbo_connection').select('id, company_name').eq('id', 1).maybeSingle(),
    supabase.from('expense_categories').select('*').eq('is_active', true).order('name'),
    fetchAll<{ id: string; display_name: string; is_vendor: boolean }>(() =>
      supabase.from('contacts').select('id, display_name, is_vendor').order('display_name').order('id')
    ),
    supabase.from('team_members').select('id, full_name').eq('is_active', true),
  ])

  const counts = Object.fromEntries(tabCounts) as Record<Tab, number>
  const demo = isDemoMode()
  const staleMs = syncState?.last_run_at ? msSince(syncState.last_run_at) : null

  return (
    <div>
      <PageHeader
        title="Banking"
        description="Transactions pulled from QuickBooks for review — approve, match, or dismiss."
      >
        <CreateTicketButton />
        {!demo && <SyncNowButton lastRunAt={syncState?.last_run_at ?? null} />}
      </PageHeader>

      {demo && (
        <div className="mb-6">
          <QuickBooksDemoNote>
            <p className="mt-2">
              The transactions below are samples, so you can try the review flow: approving one
              creates or updates the record here, as it would after a real pull.
            </p>
          </QuickBooksDemoNote>
        </div>
      )}
      {!demo && !connection && (
        <div className="card p-4 mb-6 border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          QuickBooks is not connected.{' '}
          <Link href="/settings" className="font-medium underline">
            Connect it in Settings
          </Link>{' '}
          to pull bank transactions.
        </div>
      )}
      {connection && syncState && !syncState.pull_enabled && (
        <div className="card p-4 mb-6 border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          The QuickBooks pull sync is off.{' '}
          <Link href="/settings" className="font-medium underline">
            Enable it in Settings
          </Link>{' '}
          to start pulling accepted bank transactions. Note: bank-feed lines must be
          accepted in QuickBooks (manually or via bank rules) before they are visible here.
        </div>
      )}
      {syncState?.pull_enabled && syncState.last_run_status === 'error' && (
        <div className="card p-4 mb-6 border-red-200 bg-red-50 text-sm text-red-700">
          Last sync failed: {syncState.last_run_error ?? 'unknown error'}
        </div>
      )}
      {syncState?.pull_enabled && staleMs !== null && staleMs > 24 * 60 * 60 * 1000 && (
        <div className="card p-4 mb-6 border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          The pull sync hasn&rsquo;t run in over 24 hours. Check that the scheduled job
          calling /api/cron/qbo-pull is running.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'review' ? '/banking' : `/banking?tab=${t.key}`}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className={tab === t.key ? 'ml-1.5 text-gray-300' : 'ml-1.5 text-gray-400'}>
                {counts[t.key]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          message={
            tab === 'review'
              ? 'Nothing to review — all caught up.'
              : tab === 'auto'
                ? 'Nothing has been auto-applied yet.'
                : tab === 'echo'
                  ? 'No transactions pushed from this app have been seen by the pull sync yet.'
                  : 'Nothing here yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              categories={categories ?? []}
              vendors={allContacts.filter((c) => c.is_vendor)}
              contacts={allContacts}
              teamMembers={teamMembers ?? []}
            />
          ))}
        </div>
      )}
    </div>
  )
}
