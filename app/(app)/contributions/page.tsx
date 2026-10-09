import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import type { Contribution, LetterStatus, StockContributionDetail } from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { oneEmbed } from '@/lib/reports/embed'
import { METHOD_LABELS, VEHICLE_BADGES } from './methods'
import CreateTicketButton from '@/components/CreateTicketButton'

function RestrictionBadge({ restriction }: { restriction: string }) {
  const restricted = restriction === 'donor_restricted'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        restricted ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {restricted ? 'Restricted' : 'Unrestricted'}
    </span>
  )
}

type ContributionListRow = Pick<
  Contribution,
  'id' | 'contact_id' | 'received_date' | 'amount_cents' | 'method' | 'vehicle' | 'restriction'
> & {
  contact: { display_name: string } | null
  // One-to-one embeds: an object from PostgREST, an array from the demo client
  letters: { status: LetterStatus } | { status: LetterStatus }[] | null
  stock:
    | Pick<StockContributionDetail, 'shares' | 'ticker_symbol'>
    | Pick<StockContributionDetail, 'shares' | 'ticker_symbol'>[]
    | null
}

function formatShares(shares: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(shares)
}

export default async function ContributionsPage() {
  const supabase = await createClient()

  // Calendar-year summary is summed in SQL; the list pages past max_rows.
  const currentYear = new Date().getFullYear()
  const [summaryRes, contributions] = await Promise.all([
    supabase.rpc('contribution_summary', {
      p_start: `${currentYear}-01-01`,
      p_end: `${currentYear + 1}-01-01`,
    }),
    fetchAll<ContributionListRow>(() =>
      supabase
        .from('contributions')
        .select(
          'id, contact_id, received_date, amount_cents, method, vehicle, restriction, ' +
            'contact:contacts!contact_id(display_name), ' +
            'letters:acknowledgement_letters!contribution_id(status), ' +
            'stock:stock_contribution_details!contribution_id(shares, ticker_symbol)'
        )
        .order('received_date', { ascending: false })
        .order('id')
    ),
  ])
  if (summaryRes.error) throw new Error(`Could not load contribution totals: ${summaryRes.error.message}`)
  const summary = summaryRes.data?.[0]
  const ytdCashCents = Number(summary?.cash_cents ?? 0)
  const ytdCashCount = Number(summary?.cash_count ?? 0)
  const ytdStockCents = Number(summary?.stock_cents ?? 0)
  const ytdStockCount = Number(summary?.stock_count ?? 0)
  const ytdTotalCents = ytdCashCents + ytdStockCents
  const ytdTotalCount = ytdCashCount + ytdStockCount

  return (
    <div>
      <PageHeader
        title="Contributions"
        description="Donations received and acknowledgement letters"
        action={{ href: '/contributions/new', label: 'Record contribution' }}
      >
        <CreateTicketButton />
      </PageHeader>

      <div className="card p-5 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:border-r sm:border-gray-100 sm:pr-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total contributions</p>
          <p className="text-2xl font-semibold text-gray-900 tabular-nums">
            {formatCents(ytdTotalCents)}
          </p>
          <p className="text-sm text-gray-500">
            {currentYear} · cash + stock · {ytdTotalCount} gift{ytdTotalCount === 1 ? '' : 's'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Cash contributions</p>
          <p className="text-2xl font-semibold text-gray-900 tabular-nums">
            {formatCents(ytdCashCents)}
          </p>
          <p className="text-sm text-gray-500">
            {currentYear} · {ytdCashCount} gift{ytdCashCount === 1 ? '' : 's'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Stock FMV</p>
          <p className="text-2xl font-semibold text-gray-900 tabular-nums">
            {formatCents(ytdStockCents)}
          </p>
          <p className="text-sm text-gray-500">
            {currentYear} · {ytdStockCount} gift{ytdStockCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {contributions.length === 0 ? (
        <EmptyState message="No contributions recorded yet." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Donor</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Restriction</th>
                <th className="px-4 py-3 font-medium">Letter</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => {
                const letterStatus = oneEmbed(c.letters)?.status
                const stockDetail = oneEmbed(c.stock)
                return (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{formatDate(c.received_date)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/contacts/${c.contact_id}`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {c.contact?.display_name ?? 'Unknown'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                      {c.method === 'in_kind' ? 'In-kind' : formatCents(c.amount_cents)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.method === 'stock' && stockDetail ? (
                        <span>
                          Stock · {formatShares(stockDetail.shares)}{' '}
                          {stockDetail.ticker_symbol ?? 'shares'}
                        </span>
                      ) : (
                        METHOD_LABELS[c.method]
                      )}
                      {c.vehicle !== 'direct' && (
                        <span className="text-xs text-gray-400"> · {VEHICLE_BADGES[c.vehicle]}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RestrictionBadge restriction={c.restriction} />
                    </td>
                    <td className="px-4 py-3">
                      {letterStatus ? (
                        <StatusBadge status={letterStatus} />
                      ) : (
                        <span className="text-xs text-gray-400">none</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/contributions/${c.id}`}
                        className="text-xs text-gray-500 hover:text-gray-900 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
