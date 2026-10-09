import { describe, expect, it } from 'vitest'
import { group1099Vendors, groupGrantsPaid, type Expense1099Row, type PaidDisbursementRow } from './finance'

const grant = (id: string, name: string): NonNullable<PaidDisbursementRow['grant']> => ({
  id,
  purpose: `Purpose ${id}`,
  award_date: '2026-01-15',
  grantee: { display_name: name, tax_id: '12-3456789', tax_status: null },
})

describe('groupGrantsPaid', () => {
  it('sums disbursements per grant, largest first, and drops ones without a visible grant', () => {
    const rows: PaidDisbursementRow[] = [
      { id: 'd1', grant_out_id: 'g1', amount_cents: 1000, grant: grant('g1', 'Alpha') },
      { id: 'd2', grant_out_id: 'g2', amount_cents: 5000, grant: grant('g2', 'Beta') },
      { id: 'd3', grant_out_id: 'g1', amount_cents: 7000, grant: grant('g1', 'Alpha') },
      { id: 'd4', grant_out_id: 'g3', amount_cents: 9999, grant: null },
    ]
    expect(groupGrantsPaid(rows)).toEqual([
      { id: 'g1', grantee: grant('g1', 'Alpha').grantee, purpose: 'Purpose g1', award_date: '2026-01-15', amount: 8000 },
      { id: 'g2', grantee: grant('g2', 'Beta').grantee, purpose: 'Purpose g2', award_date: '2026-01-15', amount: 5000 },
    ])
  })
})

describe('group1099Vendors', () => {
  const vendor = { display_name: 'Vendor A', tax_id: null, w9_on_file: true }
  const row = (over: Partial<Expense1099Row>): Expense1099Row => ({
    id: Math.random().toString(),
    amount_cents: 100,
    vendor_contact_id: 'v1',
    payment_method: 'check',
    status: 'paid',
    vendor,
    ...over,
  })

  it('excludes card payments and pending expenses, keeps a null payment method', () => {
    const result = group1099Vendors([
      row({ amount_cents: 100 }),
      row({ amount_cents: 200, payment_method: 'card' }),
      row({ amount_cents: 400, status: 'pending' }),
      row({ amount_cents: 800, payment_method: null, status: 'reimbursed' }),
    ])
    expect(result).toEqual([{ vendorId: 'v1', vendor, total: 900 }])
  })

  it('groups expenses without a vendor under an empty id and sorts by total', () => {
    const result = group1099Vendors([
      row({ amount_cents: 100 }),
      row({ amount_cents: 500, vendor_contact_id: null, vendor: null }),
      row({ amount_cents: 50, vendor_contact_id: 'v2', vendor: null }),
    ])
    expect(result.map((r) => [r.vendorId, r.total])).toEqual([
      ['', 500],
      ['v1', 100],
      ['v2', 50],
    ])
    expect(result[0].vendor).toBeNull()
  })
})
