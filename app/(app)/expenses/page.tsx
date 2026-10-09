import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { FUNCTIONAL_CLASS_LABELS, FUNCTIONAL_CLASS_ORDER } from './functional-class'
import type { FunctionalClass } from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'
import CreateTicketButton from '@/components/CreateTicketButton'
import SortableTh from '@/components/SortableTh'
import {
  DEFAULT_SORT,
  expenseTotals,
  nextSort,
  parseSort,
  parseStatusFilter,
  sortExpenses,
  type ExpenseRow,
  type ExpenseSort,
  type ExpenseSortKey,
  type StatusFilter,
} from '@/lib/expenses/table'

type ExpenseListRow = ExpenseRow & { vendor: { display_name: string } | null }

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string; sort?: string; dir?: string }>
}) {
  const params = await searchParams
  const categoryFilter = params.category
  const statusFilter = parseStatusFilter(params.status)
  const sort = parseSort(params.sort, params.dir)
  const supabase = await createClient()

  // Calendar-year totals and "unpaid now" are summed in SQL (unaffected by the
  // filters); the list is the complete filtered set, paged past max_rows.
  const year = new Date().getFullYear()
  const [summaryRes, { data: categories }, expenses] = await Promise.all([
    supabase.rpc('expense_summary', { p_start: `${year}-01-01`, p_end: `${year + 1}-01-01` }),
    supabase.from('expense_categories').select('id, name, functional_class').order('name').order('id'),
    fetchAll<ExpenseListRow>(() => {
      let query = supabase
        .from('expenses')
        .select(
          'id, expense_date, description, amount_cents, status, category_id, vendor_contact_id, ' +
            'vendor:contacts!vendor_contact_id(display_name)'
        )
      if (categoryFilter) query = query.eq('category_id', categoryFilter)
      // Same split as matchesStatus(): only 'pending' is unpaid
      if (statusFilter === 'unpaid') query = query.eq('status', 'pending')
      if (statusFilter === 'paid') query = query.neq('status', 'pending')
      return query.order('expense_date', { ascending: false }).order('id')
    }),
  ])
  if (summaryRes.error) throw new Error(`Could not load expense totals: ${summaryRes.error.message}`)
  const summary = summaryRes.data?.[0]

  const allCategories = categories ?? []
  const categoryMap = new Map(allCategories.map((c) => [c.id, c]))
  const vendorMap = new Map(
    expenses.flatMap((e) => (e.vendor_contact_id && e.vendor ? [[e.vendor_contact_id, e.vendor.display_name]] : []))
  )

  const ytdTotal = Number(summary?.total_cents ?? 0)
  const ytdByClass: Record<FunctionalClass, number> = {
    program: Number(summary?.program_cents ?? 0),
    management_general: Number(summary?.management_general_cents ?? 0),
    fundraising: Number(summary?.fundraising_cents ?? 0),
  }

  // Everything currently owed, regardless of date or filters.
  const unpaidNow = { count: Number(summary?.unpaid_count ?? 0), cents: Number(summary?.unpaid_cents ?? 0) }

  const filtered = sortExpenses(expenses, sort, {
    categoryName: (id) => categoryMap.get(id)?.name ?? null,
    vendorName: (id) => (id ? vendorMap.get(id) ?? null : null),
  })
  const totals = expenseTotals(filtered)

  // Links keep the other params; defaults are left out of the URL.
  const hrefWith = (next: {
    category?: string | null
    status?: StatusFilter
    sort?: ExpenseSort
  }) => {
    const category = next.category !== undefined ? next.category : categoryFilter
    const status = next.status ?? statusFilter
    const nextSortValue = next.sort ?? sort
    const q = new URLSearchParams()
    if (category) q.set('category', category)
    if (status !== 'all') q.set('status', status)
    if (nextSortValue.key !== DEFAULT_SORT.key || nextSortValue.dir !== DEFAULT_SORT.dir) {
      q.set('sort', nextSortValue.key)
      q.set('dir', nextSortValue.dir)
    }
    const qs = q.toString()
    return qs ? `/expenses?${qs}` : '/expenses'
  }
  const sortHeader = (key: ExpenseSortKey, label: string, align: 'left' | 'right' = 'left') => (
    <SortableTh
      label={label}
      href={hrefWith({ sort: nextSort(sort, key) })}
      active={sort.key === key ? sort.dir : null}
      align={align}
    />
  )
  const chipClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
      active ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
    }`

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Operating expenses tracked for Form 990 functional reporting."
        action={{ href: '/expenses/new', label: 'New expense' }}
      >
        <CreateTicketButton />
        <Link href="/expenses/upload" className="btn btn-secondary">
          Upload invoices
        </Link>
        <Link href="/expenses/categories" className="btn btn-secondary">
          Manage categories
        </Link>
      </PageHeader>

      <div className="card p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">YTD total</p>
            <p className="text-lg font-semibold text-gray-900 tabular-nums mt-1">
              {formatCents(ytdTotal)}
            </p>
          </div>
          {FUNCTIONAL_CLASS_ORDER.map((fc) => (
            <div key={fc}>
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                {FUNCTIONAL_CLASS_LABELS[fc]}
              </p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums mt-1">
                {formatCents(ytdByClass[fc])}
              </p>
            </div>
          ))}
          <Link href={hrefWith({ status: 'unpaid' })} className="group">
            <p className="text-xs text-gray-500 uppercase tracking-wide group-hover:text-gray-900">
              Unpaid now
            </p>
            <p className="text-lg font-semibold text-amber-700 tabular-nums mt-1">
              {formatCents(unpaidNow.cents)}
            </p>
            <p className="text-xs text-gray-400">
              {unpaidNow.count} {unpaidNow.count === 1 ? 'invoice' : 'invoices'}
            </p>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(
          [
            ['all', 'All'],
            ['unpaid', 'Unpaid'],
            ['paid', 'Paid'],
          ] as const
        ).map(([value, label]) => (
          <Link key={value} href={hrefWith({ status: value })} className={chipClass(statusFilter === value)}>
            {label}
          </Link>
        ))}
      </div>

      {allCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Link href={hrefWith({ category: null })} className={chipClass(!categoryFilter)}>
            All categories
          </Link>
          {allCategories.map((c) => (
            <Link
              key={c.id}
              href={hrefWith({ category: c.id })}
              className={chipClass(categoryFilter === c.id)}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          message={
            categoryFilter || statusFilter !== 'all'
              ? 'No expenses match these filters.'
              : 'No expenses recorded yet.'
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                {sortHeader('date', 'Date')}
                {sortHeader('description', 'Description')}
                {sortHeader('category', 'Category')}
                {sortHeader('vendor', 'Vendor')}
                {sortHeader('status', 'Status')}
                {sortHeader('amount', 'Amount', 'right')}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {formatDate(e.expense_date)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/expenses/${e.id}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {e.description}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {categoryMap.get(e.category_id)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {e.vendor_contact_id ? vendorMap.get(e.vendor_contact_id) ?? '—' : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {formatCents(e.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              {statusFilter !== 'paid' && (
                <TotalsRow label="Unpaid" count={totals.unpaid.count} cents={totals.unpaid.cents} first />
              )}
              {statusFilter !== 'unpaid' && (
                <TotalsRow
                  label="Paid"
                  count={totals.paid.count}
                  cents={totals.paid.cents}
                  first={statusFilter === 'paid'}
                />
              )}
              <TotalsRow label="Total" count={totals.total.count} cents={totals.total.cents} strong />
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function TotalsRow({
  label,
  count,
  cents,
  first = false,
  strong = false,
}: {
  label: string
  count: number
  cents: number
  first?: boolean
  strong?: boolean
}) {
  return (
    <tr className={`${first ? 'border-t-2 border-gray-200' : ''} ${strong ? 'bg-gray-50' : ''}`}>
      <td colSpan={5} className={`px-4 py-2 ${strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
        {label}
        <span className="ml-2 text-xs font-normal text-gray-400">
          {count} {count === 1 ? 'expense' : 'expenses'}
        </span>
      </td>
      <td
        className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${
          strong ? 'font-semibold text-gray-900' : 'text-gray-700'
        }`}
      >
        {formatCents(cents)}
      </td>
    </tr>
  )
}
