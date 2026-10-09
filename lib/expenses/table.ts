import type { ExpenseStatus } from '@/lib/supabase/types/database'

/**
 * Pure sorting, filtering and totals for the /expenses table. Sort and filter
 * live in the URL (?sort=amount&dir=desc&status=unpaid) so views survive a
 * reload and can be shared.
 */

export const EXPENSE_SORT_KEYS = ['date', 'description', 'category', 'vendor', 'status', 'amount'] as const
export type ExpenseSortKey = (typeof EXPENSE_SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'
export type ExpenseSort = { key: ExpenseSortKey; dir: SortDir }

/** First-click direction per column: newest/largest first, text A→Z, unpaid first. */
export const DEFAULT_SORT_DIR: Record<ExpenseSortKey, SortDir> = {
  date: 'desc',
  amount: 'desc',
  description: 'asc',
  category: 'asc',
  vendor: 'asc',
  status: 'asc',
}

export const DEFAULT_SORT: ExpenseSort = { key: 'date', dir: 'desc' }

export function parseSort(sort: string | undefined, dir: string | undefined): ExpenseSort {
  const key = EXPENSE_SORT_KEYS.find((k) => k === sort) ?? DEFAULT_SORT.key
  const parsedDir: SortDir = dir === 'asc' || dir === 'desc' ? dir : DEFAULT_SORT_DIR[key]
  return { key, dir: parsedDir }
}

/** The sort a click on `key` produces: toggle the active column, else its default. */
export function nextSort(current: ExpenseSort, key: ExpenseSortKey): ExpenseSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: DEFAULT_SORT_DIR[key] }
}

export type StatusFilter = 'all' | 'unpaid' | 'paid'

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return value === 'unpaid' || value === 'paid' ? value : 'all'
}

/** Reimbursed counts as paid: a team member paid, and the organization has paid them back. */
export function isUnpaid(status: ExpenseStatus): boolean {
  return status === 'pending'
}

export function matchesStatus(status: ExpenseStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  return filter === 'unpaid' ? isUnpaid(status) : !isUnpaid(status)
}

export type ExpenseRow = {
  id: string
  expense_date: string
  description: string
  amount_cents: number
  status: ExpenseStatus
  category_id: string
  vendor_contact_id: string | null
}

export type ExpenseLookups = {
  categoryName: (id: string) => string | null
  vendorName: (id: string | null) => string | null
}

const STATUS_ORDER: Record<ExpenseStatus, number> = { pending: 0, paid: 1, reimbursed: 2 }

function sortValue(row: ExpenseRow, key: ExpenseSortKey, lookups: ExpenseLookups): string | number | null {
  switch (key) {
    case 'date':
      return row.expense_date
    case 'amount':
      return row.amount_cents
    case 'description':
      return row.description.trim().toLowerCase() || null
    case 'category':
      return lookups.categoryName(row.category_id)?.toLowerCase() ?? null
    case 'vendor':
      return lookups.vendorName(row.vendor_contact_id)?.toLowerCase() ?? null
    case 'status':
      return STATUS_ORDER[row.status]
  }
}

/**
 * Stable sort. Blank values (no vendor, missing category) always go last in
 * either direction; ties fall back to newest date first, then id.
 */
export function sortExpenses<T extends ExpenseRow>(rows: T[], sort: ExpenseSort, lookups: ExpenseLookups): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key, lookups)
    const vb = sortValue(b, sort.key, lookups)
    if (va === null && vb !== null) return 1
    if (vb === null && va !== null) return -1
    if (va !== null && vb !== null && va !== vb) {
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      if (cmp !== 0) return cmp * sign
    }
    if (a.expense_date !== b.expense_date) return a.expense_date < b.expense_date ? 1 : -1
    return a.id.localeCompare(b.id)
  })
}

export type Totals = { count: number; cents: number }

export function expenseTotals(rows: Pick<ExpenseRow, 'status' | 'amount_cents'>[]): {
  unpaid: Totals
  paid: Totals
  total: Totals
} {
  const unpaid = { count: 0, cents: 0 }
  const paid = { count: 0, cents: 0 }
  for (const r of rows) {
    const bucket = isUnpaid(r.status) ? unpaid : paid
    bucket.count += 1
    bucket.cents += r.amount_cents
  }
  return { unpaid, paid, total: { count: unpaid.count + paid.count, cents: unpaid.cents + paid.cents } }
}
