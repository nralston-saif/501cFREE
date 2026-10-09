import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentFiscalYear, fiscalYearRange, reportCalendarYear } from '@/lib/utils/fiscal-year'
import { getAuthState } from '@/lib/auth'
import { getOrgSettings } from '@/lib/settings'
import { TAX_STATUS_LABELS } from '@/lib/utils/tax-status'
import { toCsv } from '@/lib/exports/csv'
import type { Contribution, ExpenseStatus, StockContributionDetail } from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { oneEmbed } from '@/lib/reports/embed'
import {
  group1099Vendors,
  groupGrantsPaid,
  load1099Expenses,
  loadExpenseCategories,
  loadPaidDisbursements,
} from '@/lib/reports/finance'

const REPORTS = new Set(['expenses', 'contributions', 'grants-paid', '1099-vendors'])

type ExportStock = Pick<
  StockContributionDetail,
  | 'security_name'
  | 'ticker_symbol'
  | 'shares'
  | 'valuation_date'
  | 'fmv_per_share_cents'
  | 'valuation_source'
  | 'sale_date'
  | 'sale_net_cents'
>

type ExportContribution = Pick<
  Contribution,
  | 'id'
  | 'received_date'
  | 'contact_id'
  | 'amount_cents'
  | 'method'
  | 'vehicle'
  | 'vehicle_sponsor_name'
  | 'restriction'
  | 'quid_pro_quo'
> & {
  donor: { display_name: string } | null
  // One-to-one: an object from PostgREST, an array from the demo client
  stock: ExportStock | ExportStock[] | null
}

/** Integer cents -> decimal dollar string with 2dp, '' for null */
function dollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

/** Like dollars() but keeps sub-cent precision (per-share prices stored as numeric). */
function perShareDollars(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return ''
  const n = typeof cents === 'string' ? Number(cents) : cents
  if (!Number.isFinite(n)) return ''
  return String(Number((n / 100).toFixed(6)))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report } = await params

  // Same gate as the Reports page (app/(app)/reports/layout.tsx): admins
  // only. The expense-derived reports would otherwise come back empty under
  // RLS, and the contribution export belongs with the rest of the page.
  const { userId, memberId, isAdmin } = await getAuthState()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!memberId || !isAdmin) {
    return NextResponse.json({ error: 'Reports are available to admins only' }, { status: 403 })
  }

  if (!REPORTS.has(report)) {
    return NextResponse.json({ error: 'Unknown report' }, { status: 404 })
  }

  const supabase = await createClient()

  const settings = await getOrgSettings(supabase)
  const startMonth = settings.fiscal_year_start_month

  const fyParam = Number(request.nextUrl.searchParams.get('fy'))
  const fy =
    Number.isInteger(fyParam) && fyParam > 1900 && fyParam < 3000
      ? fyParam
      : currentFiscalYear(startMonth, settings.timezone)
  const { start, end } = fiscalYearRange(fy, startMonth)
  // 1099s are calendar-year: ?cy=, else the current calendar year
  const cy = reportCalendarYear(request.nextUrl.searchParams.get('cy'), settings.timezone)

  let csv: string

  switch (report) {
    case 'expenses': {
      const [expenses, categories] = await Promise.all([
        fetchAll<{
          expense_date: string
          description: string
          amount_cents: number
          category_id: string
          vendor_contact_id: string | null
          status: ExpenseStatus
          vendor: { display_name: string } | null
        }>(() =>
          supabase
            .from('expenses')
            .select(
              'expense_date, description, amount_cents, category_id, vendor_contact_id, status, ' +
                'vendor:contacts!vendor_contact_id(display_name)'
            )
            .gte('expense_date', start)
            .lt('expense_date', end)
            .order('expense_date')
            .order('id')
        ),
        loadExpenseCategories(supabase),
      ])
      const categoryById = new Map(categories.map((c) => [c.id, c]))

      csv = toCsv(
        ['date', 'description', 'category', 'functional_class', 'vendor', 'status', 'amount'],
        expenses.map((e) => {
          const category = categoryById.get(e.category_id)
          return [
            e.expense_date,
            e.description,
            category?.name ?? '',
            category?.functional_class ?? '',
            e.vendor_contact_id ? (e.vendor?.display_name ?? '') : '',
            e.status,
            dollars(e.amount_cents),
          ]
        })
      )
      break
    }

    case 'contributions': {
      const contributions = await fetchAll<ExportContribution>(() =>
        supabase
          .from('contributions')
          .select(
            'id, received_date, contact_id, amount_cents, method, vehicle, vehicle_sponsor_name, restriction, quid_pro_quo, ' +
              'donor:contacts!contact_id(display_name), ' +
              'stock:stock_contribution_details!contribution_id(security_name, ticker_symbol, shares, ' +
              'valuation_date, fmv_per_share_cents, valuation_source, sale_date, sale_net_cents)'
          )
          .gte('received_date', start)
          .lt('received_date', end)
          .order('received_date')
          .order('id')
      )

      csv = toCsv(
        [
          'date',
          'donor',
          'amount_or_internal_fmv',
          'method',
          'vehicle',
          'vehicle_sponsor',
          'restriction',
          'quid_pro_quo',
          'security',
          'ticker',
          'shares',
          'valuation_date',
          'fmv_per_share',
          'valuation_source',
          'sale_date',
          'sale_net',
        ],
        contributions.map((c) => {
          const stock = c.method === 'stock' ? oneEmbed(c.stock) : null
          return [
            c.received_date,
            c.donor?.display_name ?? '',
            dollars(c.amount_cents),
            c.method,
            c.vehicle,
            c.vehicle_sponsor_name ?? '',
            c.restriction,
            c.quid_pro_quo ? 'yes' : 'no',
            stock?.security_name ?? '',
            stock?.ticker_symbol ?? '',
            stock?.shares ?? '',
            stock?.valuation_date ?? '',
            perShareDollars(stock?.fmv_per_share_cents),
            stock?.valuation_source ?? '',
            stock?.sale_date ?? '',
            dollars(stock?.sale_net_cents),
          ]
        })
      )
      break
    }

    case 'grants-paid': {
      const grants = groupGrantsPaid(await loadPaidDisbursements(supabase, start, end))
      csv = toCsv(
        ['grantee', 'ein', 'tax_status', 'purpose', 'award_date', 'amount_disbursed_in_fy'],
        grants.map((g) => [
          g.grantee?.display_name ?? '',
          g.grantee?.tax_id ?? '',
          g.grantee?.tax_status ? TAX_STATUS_LABELS[g.grantee.tax_status] : '',
          g.purpose ?? '',
          g.award_date ?? '',
          dollars(g.amount),
        ])
      )
      break
    }

    default: {
      // '1099-vendors' — always calendar-year (1099s are filed per calendar
      // year regardless of fiscal year). Card payments are excluded: the card
      // processor reports those on Form 1099-K. Pending expenses aren't
      // payments yet.
      const vendors = group1099Vendors(await load1099Expenses(supabase, cy))
      csv = toCsv(
        ['vendor', 'ein', 'w9_on_file', 'total'],
        vendors.map(({ vendorId, vendor, total }) => [
          vendor?.display_name ?? '(No vendor recorded)',
          vendor?.tax_id ?? '',
          vendorId ? (vendor?.w9_on_file ? 'yes' : 'no') : '',
          dollars(total),
        ])
      )
      break
    }
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${report}-${report === '1099-vendors' ? `cy${cy}` : `fy${fy}`}.csv"`,
    },
  })
}
