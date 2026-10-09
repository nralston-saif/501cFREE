import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { INSTRUMENT_LABELS } from '@/lib/pris/instruments'
import { METHOD_LABELS } from '@/app/(app)/contributions/methods'
import type { FundingData } from './load'

// Money tied to a contact: grants awarded, proposals, PRIs, contributions
// received and (admins only) expenses paid to them. Empty subsections are
// hidden. Organizations call it "Funding"; people "Giving history", with
// contributions first.

const th = 'px-4 py-2 font-medium'
const td = 'px-4 py-3'

function Subsection({
  title,
  total,
  children,
}: {
  title: string
  total?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {total && <span className="text-xs text-gray-500">{total}</span>}
      </div>
      <div className="overflow-x-auto border border-gray-100 rounded-lg">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  )
}

function ViewLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs text-gray-500 hover:text-gray-900 hover:underline">
      View
    </Link>
  )
}

export default function FundingSection({
  data,
  variant,
}: {
  data: FundingData
  variant: 'organization' | 'person'
}) {
  const { grants, proposals, pris, contributions, expenses } = data
  const sum = (values: (number | null)[]) => values.reduce<number>((a, b) => a + (b ?? 0), 0)

  const awarded = sum(grants.map((g) => g.amount_awarded_cents))
  const paid = sum(grants.map((g) => g.paid_cents))
  const priTotal = sum(pris.map((p) => p.amount_cents))
  const given = sum(contributions.map((c) => (c.method === 'in_kind' ? null : c.amount_cents)))
  const spent = sum((expenses ?? []).map((e) => e.amount_cents))

  const totals: string[] = []
  if (contributions.length) totals.push(`${formatCents(given)} contributed`)
  if (grants.length) totals.push(`${formatCents(awarded)} granted (${formatCents(paid)} paid)`)
  if (pris.length) totals.push(`${formatCents(priTotal)} in PRIs`)
  if (expenses?.length) totals.push(`${formatCents(spent)} in expenses`)

  const empty = !grants.length && !proposals.length && !pris.length && !contributions.length && !expenses?.length

  const grantsTable = grants.length > 0 && (
    <Subsection key="grants" title="Grants awarded" total={`${formatCents(awarded)} awarded · ${formatCents(paid)} paid`}>
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <th className={th}>Award date</th>
          <th className={th}>Purpose</th>
          <th className={`${th} text-right`}>Awarded</th>
          <th className={`${th} text-right`}>Paid</th>
          <th className={`${th} text-right`}>Scheduled</th>
          <th className={th}>Status</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {grants.map((g) => (
          <tr key={g.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
            <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDate(g.award_date)}</td>
            <td className={`${td} text-gray-600`}>{g.purpose ?? '—'}</td>
            <td className={`${td} text-right tabular-nums text-gray-900`}>{formatCents(g.amount_awarded_cents)}</td>
            <td className={`${td} text-right tabular-nums text-gray-600`}>{formatCents(g.paid_cents)}</td>
            <td className={`${td} text-right tabular-nums text-gray-600`}>
              {g.scheduled_cents ? formatCents(g.scheduled_cents) : '—'}
            </td>
            <td className={td}>
              <StatusBadge status={g.status} />
            </td>
            <td className={`${td} text-right`}>
              <ViewLink href={`/grants-out/awards/${g.id}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </Subsection>
  )

  const proposalsTable = proposals.length > 0 && (
    <Subsection key="proposals" title="Grant proposals" total={`${proposals.length} on file`}>
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <th className={th}>Received</th>
          <th className={th}>Title</th>
          <th className={`${th} text-right`}>Requested</th>
          <th className={th}>Status</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {proposals.map((p) => (
          <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
            <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDate(p.date)}</td>
            <td className={`${td} text-gray-800`}>{p.title}</td>
            <td className={`${td} text-right tabular-nums text-gray-600`}>
              {p.amount_requested_cents ? formatCents(p.amount_requested_cents) : '—'}
            </td>
            <td className={td}>
              <StatusBadge status={p.decision ?? p.status} />
            </td>
            <td className={`${td} text-right`}>
              <ViewLink href={`/grants-out/proposals/${p.id}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </Subsection>
  )

  const prisTable = pris.length > 0 && (
    <Subsection key="pris" title="Program-related investments" total={formatCents(priTotal)}>
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <th className={th}>Date</th>
          <th className={th}>Instrument</th>
          <th className={th}>Purpose</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={th}>Status</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {pris.map((p) => (
          <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
            <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDate(p.date)}</td>
            <td className={`${td} text-gray-600`}>{INSTRUMENT_LABELS[p.instrument]}</td>
            <td className={`${td} text-gray-600`}>{p.purpose ?? '—'}</td>
            <td className={`${td} text-right tabular-nums text-gray-900`}>{formatCents(p.amount_cents)}</td>
            <td className={td}>
              <StatusBadge status={p.status} />
            </td>
            <td className={`${td} text-right`}>
              <ViewLink href={`/pris/${p.id}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </Subsection>
  )

  const contributionsTable = contributions.length > 0 && (
    <Subsection key="contributions" title="Contributions received" total={`${formatCents(given)} total`}>
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <th className={th}>Date</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={th}>Method</th>
          <th className={th}>Letter</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {contributions.map((c) => (
          <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
            <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDate(c.received_date)}</td>
            <td className={`${td} text-right tabular-nums text-gray-900`}>
              {c.method === 'in_kind' ? 'In-kind' : formatCents(c.amount_cents)}
            </td>
            <td className={`${td} text-gray-600`}>{METHOD_LABELS[c.method]}</td>
            <td className={td}>
              {c.letter_status ? (
                <StatusBadge status={c.letter_status} />
              ) : (
                <span className="text-xs text-gray-400">none</span>
              )}
            </td>
            <td className={`${td} text-right`}>
              <ViewLink href={`/contributions/${c.id}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </Subsection>
  )

  const expensesTable = expenses && expenses.length > 0 && (
    <Subsection key="expenses" title="Expenses paid to them" total={`${formatCents(spent)} total · admins only`}>
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <th className={th}>Date</th>
          <th className={th}>Description</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={th}>Status</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {expenses.map((e) => (
          <tr key={e.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
            <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDate(e.expense_date)}</td>
            <td className={`${td} text-gray-600`}>{e.description}</td>
            <td className={`${td} text-right tabular-nums text-gray-900`}>{formatCents(e.amount_cents)}</td>
            <td className={td}>
              <StatusBadge status={e.status} />
            </td>
            <td className={`${td} text-right`}>
              <ViewLink href={`/expenses/${e.id}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </Subsection>
  )

  const sections =
    variant === 'person'
      ? [contributionsTable, grantsTable, proposalsTable, prisTable, expensesTable]
      : [grantsTable, proposalsTable, prisTable, contributionsTable, expensesTable]

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{variant === 'person' ? 'Giving history' : 'Funding'}</h2>
        {totals.length > 0 && <p className="text-sm text-gray-500">{totals.join(' · ')}</p>}
      </div>
      {empty ? (
        <p className="text-sm text-gray-500 italic">
          {variant === 'person'
            ? 'No contributions, grants or PRIs yet.'
            : 'No grants, proposals, PRIs or contributions yet.'}
        </p>
      ) : (
        <div className="space-y-6">{sections}</div>
      )}
    </div>
  )
}
