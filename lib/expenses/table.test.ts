import { describe, expect, it } from 'vitest'
import {
  expenseTotals,
  matchesStatus,
  nextSort,
  parseSort,
  parseStatusFilter,
  sortExpenses,
  type ExpenseRow,
} from './table'

const row = (id: string, o: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id,
  expense_date: '2026-08-01',
  description: id,
  amount_cents: 100,
  status: 'paid',
  category_id: 'cat-legal',
  vendor_contact_id: null,
  ...o,
})

const lookups = {
  categoryName: (id: string) => ({ 'cat-legal': 'Legal fees', 'cat-soft': 'Software & IT' })[id] ?? null,
  vendorName: (id: string | null) => (id ? ({ ap: 'Contoso Legal', tgs: 'Northwind Advisory' })[id] ?? null : null),
}

const ids = (rows: ExpenseRow[]) => rows.map((r) => r.id)

describe('parseSort / nextSort', () => {
  it('defaults to newest first and ignores junk', () => {
    expect(parseSort(undefined, undefined)).toEqual({ key: 'date', dir: 'desc' })
    expect(parseSort('nope', 'sideways')).toEqual({ key: 'date', dir: 'desc' })
  })

  it('uses the column default direction when none is given', () => {
    expect(parseSort('vendor', undefined)).toEqual({ key: 'vendor', dir: 'asc' })
    expect(parseSort('amount', undefined)).toEqual({ key: 'amount', dir: 'desc' })
  })

  it('toggles the active column and starts others at their default', () => {
    expect(nextSort({ key: 'amount', dir: 'desc' }, 'amount')).toEqual({ key: 'amount', dir: 'asc' })
    expect(nextSort({ key: 'amount', dir: 'asc' }, 'vendor')).toEqual({ key: 'vendor', dir: 'asc' })
  })
})

describe('sortExpenses', () => {
  const rows = [
    row('a', { expense_date: '2026-06-05', amount_cents: 1_451_280, status: 'paid', vendor_contact_id: 'ap' }),
    row('b', { expense_date: '2026-09-11', amount_cents: 37_281, status: 'pending', vendor_contact_id: 'ap' }),
    row('c', { expense_date: '2026-07-31', amount_cents: 312_500, status: 'reimbursed', category_id: 'cat-soft', vendor_contact_id: 'tgs' }),
    row('d', { expense_date: '2026-08-31', amount_cents: 531_250, status: 'pending' }),
  ]

  it('sorts by date and amount in both directions', () => {
    expect(ids(sortExpenses(rows, { key: 'date', dir: 'desc' }, lookups))).toEqual(['b', 'd', 'c', 'a'])
    expect(ids(sortExpenses(rows, { key: 'amount', dir: 'desc' }, lookups))).toEqual(['a', 'd', 'c', 'b'])
    expect(ids(sortExpenses(rows, { key: 'amount', dir: 'asc' }, lookups))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('puts unpaid first when sorting by status, then paid, then reimbursed', () => {
    expect(ids(sortExpenses(rows, { key: 'status', dir: 'asc' }, lookups))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('keeps rows with no vendor last in either direction', () => {
    expect(ids(sortExpenses(rows, { key: 'vendor', dir: 'asc' }, lookups)).at(-1)).toBe('d')
    expect(ids(sortExpenses(rows, { key: 'vendor', dir: 'desc' }, lookups)).at(-1)).toBe('d')
  })

  it('breaks ties by newest date', () => {
    // a and b share the vendor; b is newer.
    expect(ids(sortExpenses(rows, { key: 'vendor', dir: 'asc' }, lookups)).slice(0, 2)).toEqual(['b', 'a'])
  })

  it('sorts by category name, not id', () => {
    expect(ids(sortExpenses(rows, { key: 'category', dir: 'desc' }, lookups))[0]).toBe('c')
  })

  it('does not mutate the input', () => {
    const before = ids(rows)
    sortExpenses(rows, { key: 'amount', dir: 'asc' }, lookups)
    expect(ids(rows)).toEqual(before)
  })
})

describe('status filter and totals', () => {
  it('treats reimbursed as paid', () => {
    expect(matchesStatus('reimbursed', 'paid')).toBe(true)
    expect(matchesStatus('reimbursed', 'unpaid')).toBe(false)
    expect(matchesStatus('pending', 'unpaid')).toBe(true)
    expect(parseStatusFilter('bogus')).toBe('all')
  })

  it('totals unpaid, paid, and both', () => {
    const t = expenseTotals([
      { status: 'pending', amount_cents: 37_281 },
      { status: 'pending', amount_cents: 531_250 },
      { status: 'paid', amount_cents: 175_830 },
      { status: 'reimbursed', amount_cents: 1_000 },
    ])
    expect(t.unpaid).toEqual({ count: 2, cents: 568_531 })
    expect(t.paid).toEqual({ count: 2, cents: 176_830 })
    expect(t.total).toEqual({ count: 4, cents: 745_361 })
  })
})
