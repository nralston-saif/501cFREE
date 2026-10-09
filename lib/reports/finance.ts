import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContactTaxStatus,
  Database,
  ExpensePaymentMethod,
  ExpenseStatus,
  FunctionalClass,
} from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'

/**
 * Row sets shared by the Reports page and its CSV exports
 * (app/api/exports/[report]/route.ts). Every query pages with fetchAll() so
 * a report is complete at any size, and names come from foreign-key embeds
 * instead of `.in('id', ids)` lookups.
 */

type Client = SupabaseClient<Database>

// --- Grants paid (990 Schedule I) ---

export type Grantee = { display_name: string; tax_id: string | null; tax_status: ContactTaxStatus | null }

export type PaidDisbursementRow = {
  id: string
  grant_out_id: string
  amount_cents: number
  grant: {
    id: string
    purpose: string | null
    award_date: string | null
    grantee: Grantee | null
  } | null
}

export type GrantPaid = {
  id: string
  grantee: Grantee | null
  purpose: string | null
  award_date: string | null
  amount: number
}

/** Disbursements paid in [start, end), each with its grant and grantee. */
export function loadPaidDisbursements(supabase: Client, start: string, end: string) {
  return fetchAll<PaidDisbursementRow>(() =>
    supabase
      .from('disbursements')
      .select(
        'id, grant_out_id, amount_cents, ' +
          'grant:grants_out!grant_out_id(id, purpose, award_date, ' +
          'grantee:contacts!grantee_contact_id(display_name, tax_id, tax_status))'
      )
      .eq('status', 'paid')
      .gte('paid_date', start)
      .lt('paid_date', end)
      .order('paid_date')
      .order('id')
  )
}

/**
 * One row per grant: the sum of its paid disbursements, largest first.
 * Disbursements whose grant isn't visible are left out (as before, when the
 * grants were looked up separately).
 */
export function groupGrantsPaid(rows: PaidDisbursementRow[]): GrantPaid[] {
  const byGrant = new Map<string, GrantPaid>()
  for (const d of rows) {
    if (!d.grant) continue
    const entry =
      byGrant.get(d.grant_out_id) ??
      {
        id: d.grant_out_id,
        grantee: d.grant.grantee,
        purpose: d.grant.purpose,
        award_date: d.grant.award_date,
        amount: 0,
      }
    entry.amount += d.amount_cents
    byGrant.set(d.grant_out_id, entry)
  }
  return [...byGrant.values()].sort((a, b) => b.amount - a.amount)
}

// --- 1099 vendors ---

export type Expense1099Row = {
  id: string
  amount_cents: number
  vendor_contact_id: string | null
  payment_method: ExpensePaymentMethod | null
  status: ExpenseStatus
  vendor: { display_name: string; tax_id: string | null; w9_on_file: boolean } | null
}

export type Vendor1099 = {
  /** '' for expenses with no vendor recorded */
  vendorId: string
  vendor: Expense1099Row['vendor']
  total: number
}

/** 1099-eligible expenses dated in calendar year `cy`, with their vendor. */
export function load1099Expenses(supabase: Client, cy: number) {
  return fetchAll<Expense1099Row>(() =>
    supabase
      .from('expenses')
      .select(
        'id, amount_cents, vendor_contact_id, payment_method, status, ' +
          'vendor:contacts!vendor_contact_id(display_name, tax_id, w9_on_file)'
      )
      .eq('is_1099_eligible', true)
      .gte('expense_date', `${cy}-01-01`)
      .lt('expense_date', `${cy + 1}-01-01`)
      .order('expense_date')
      .order('id')
  )
}

/**
 * Totals per vendor, largest first. Card payments are excluded: the card
 * processor reports those on Form 1099-K, so including them would
 * double-report. Pending expenses aren't payments yet.
 */
export function group1099Vendors(rows: Expense1099Row[]): Vendor1099[] {
  const byVendor = new Map<string, Vendor1099>()
  for (const e of rows) {
    if (e.payment_method === 'card' || e.status === 'pending') continue
    const key = e.vendor_contact_id ?? ''
    const entry = byVendor.get(key) ?? { vendorId: key, vendor: key ? e.vendor : null, total: 0 }
    entry.total += e.amount_cents
    byVendor.set(key, entry)
  }
  return [...byVendor.values()].sort((a, b) => b.total - a.total)
}

// --- Categories ---

export type ReportCategory = {
  id: string
  name: string
  functional_class: FunctionalClass
  form_990_line: string | null
}

export function loadExpenseCategories(supabase: Client) {
  return fetchAll<ReportCategory>(() =>
    supabase.from('expense_categories').select('id, name, functional_class, form_990_line').order('name').order('id')
  )
}
