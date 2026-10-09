import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { INSTRUMENT_LABELS } from './instruments'
import CreateTicketButton from '@/components/CreateTicketButton'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { Pri } from '@/lib/supabase/types/database'

type PriListRow = Pick<Pri, 'id' | 'instrument' | 'purpose' | 'amount_cents' | 'funded_date' | 'status'> & {
  recipient: { display_name: string } | null
}

export default async function PrisPage() {
  const supabase = await createClient()

  // Every PRI (totals are summed over the list), recipient names embedded
  const all = await fetchAll<PriListRow>(() =>
    supabase
      .from('pris')
      .select(
        'id, instrument, purpose, amount_cents, funded_date, status, ' +
          'recipient:contacts!recipient_contact_id(display_name)'
      )
      .order('created_at', { ascending: false })
      .order('id')
  )

  // Held at cost = funded money still out as an investment. Converted SAFEs
  // are still held (as equity); repaid / exited / written-off are not.
  const heldTotal = all
    .filter((p) => p.status === 'funded' || p.status === 'converted')
    .reduce((sum, p) => sum + p.amount_cents, 0)
  const committedTotal = all
    .filter((p) => p.status === 'committed')
    .reduce((sum, p) => sum + p.amount_cents, 0)

  return (
    <div>
      <PageHeader
        title="Program-related investments"
        description="Mission-aligned investments (SAFEs, notes, equity) — assets on the balance sheet, reported on 990 Part X line 13, never as grants."
        action={{ href: '/pris/new', label: 'New PRI' }}
      >
        <CreateTicketButton />
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Held at cost</p>
          <p className="text-lg font-semibold tabular-nums">{formatCents(heldTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Committed, unfunded</p>
          <p className="text-lg font-semibold tabular-nums">{formatCents(committedTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Investments</p>
          <p className="text-lg font-semibold tabular-nums">{all.length}</p>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyState message="No program-related investments yet. Record one to get started." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="px-4 py-3 font-medium">Recipient</th>
                <th className="px-4 py-3 font-medium">Instrument</th>
                <th className="px-4 py-3 font-medium">Purpose</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Funded</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {all.map((p) => (
                <tr
                  key={p.id}
                  className="relative border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/pris/${p.id}`}
                      className="font-medium text-gray-900 hover:underline before:absolute before:inset-0 before:content-['']"
                    >
                      {p.recipient?.display_name ?? 'Unknown recipient'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{INSTRUMENT_LABELS[p.instrument]}</td>
                  <td className="px-4 py-3 text-gray-600">{p.purpose ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(p.amount_cents)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(p.funded_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
