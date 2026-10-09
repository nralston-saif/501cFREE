import { Fragment } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import { formatCents } from '@/lib/utils/money'
import { currentFiscalYear, fiscalYearRange, inclusiveEnd, reportCalendarYear } from '@/lib/utils/fiscal-year'
import { getOrgSettings } from '@/lib/settings'
import { withBasePath } from '@/lib/basePath'
import type { Contribution, FunctionalClass, Pri } from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'
import {
  group1099Vendors,
  groupGrantsPaid,
  load1099Expenses,
  loadExpenseCategories,
  loadPaidDisbursements,
} from '@/lib/reports/finance'
import { TAX_STATUS_LABELS } from '@/lib/utils/tax-status'
import { formatDate } from '@/lib/utils/dates'
import StatusBadge from '@/components/StatusBadge'
import { INSTRUMENT_LABELS } from '../pris/instruments'
import CreateTicketButton from '@/components/CreateTicketButton'

const FUNCTIONAL_CLASS_ORDER: FunctionalClass[] = ['program', 'management_general', 'fundraising']

const FUNCTIONAL_CLASS_LABELS: Record<FunctionalClass, string> = {
  program: 'Program',
  management_general: 'Management & general',
  fundraising: 'Fundraising',
}

type ReportContribution = Pick<Contribution, 'id' | 'contact_id' | 'amount_cents' | 'method' | 'restriction'> & {
  contact: { display_name: string } | null
}

type ReportPri = Pick<Pri, 'id' | 'instrument' | 'purpose' | 'funded_date' | 'status' | 'amount_cents'> & {
  recipient: { display_name: string } | null
}

function SectionHeader({ title, csvHref }: { title: string; csvHref: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-medium text-gray-900">{title}</h2>
      <a href={withBasePath(csvHref)} className="text-xs text-gray-500 hover:text-gray-900 underline">
        Download CSV
      </a>
    </div>
  )
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; cy?: string }>
}) {
  const { fy: fyParam, cy: cyParam } = await searchParams
  const supabase = await createClient()

  const settings = await getOrgSettings(supabase)

  const startMonth = settings.fiscal_year_start_month
  const current = currentFiscalYear(startMonth, settings.timezone)
  const parsed = Number(fyParam)
  const fy = Number.isInteger(parsed) && parsed > 1900 && parsed < 3000 ? parsed : current
  const { start, end } = fiscalYearRange(fy, startMonth)
  const fyOptions = [current, current - 1, current - 2]
  // 1099s are calendar-year, so that section has its own year
  const currentCy = reportCalendarYear(null, settings.timezone)
  const cy = reportCalendarYear(cyParam, settings.timezone)
  const cyOptions = [currentCy, currentCy - 1, currentCy - 2]

  // Every row set is paged past max_rows (fetchAll) so the report is
  // complete at any size; names come from foreign-key embeds.
  const [expenses, categories, contributions, paidDisbursements, expenses1099, pris] = await Promise.all([
    fetchAll<{ id: string; amount_cents: number; category_id: string }>(() =>
      supabase
        .from('expenses')
        .select('id, amount_cents, category_id')
        .gte('expense_date', start)
        .lt('expense_date', end)
        .order('id')
    ),
    loadExpenseCategories(supabase),
    fetchAll<ReportContribution>(() =>
      supabase
        .from('contributions')
        .select('id, contact_id, amount_cents, method, restriction, contact:contacts!contact_id(display_name)')
        .gte('received_date', start)
        .lt('received_date', end)
        .order('id')
    ),
    loadPaidDisbursements(supabase, start, end),
    // 1099s are always calendar-year, regardless of the org's fiscal year.
    load1099Expenses(supabase, cy),
    // Balance-sheet view: every PRI funded on or before this FY's end
    fetchAll<ReportPri>(() =>
      supabase
        .from('pris')
        .select(
          'id, instrument, purpose, funded_date, status, amount_cents, ' +
            'recipient:contacts!recipient_contact_id(display_name)'
        )
        .not('funded_date', 'is', null)
        .lt('funded_date', end)
        .order('id')
    ),
  ])

  // --- Functional expenses ---
  const totalsByCategory = new Map<string, number>()
  for (const e of expenses) {
    totalsByCategory.set(e.category_id, (totalsByCategory.get(e.category_id) ?? 0) + e.amount_cents)
  }
  const expenseClasses = FUNCTIONAL_CLASS_ORDER.map((fc) => {
    const rows = categories
      .filter((c) => c.functional_class === fc && totalsByCategory.has(c.id))
      .map((c) => ({ category: c, total: totalsByCategory.get(c.id) ?? 0 }))
      .sort((a, b) => a.category.name.localeCompare(b.category.name))
    return { fc, rows, subtotal: rows.reduce((sum, r) => sum + r.total, 0) }
  }).filter((group) => group.rows.length > 0)
  const expensesGrandTotal = expenses.reduce((sum, e) => sum + e.amount_cents, 0)

  // --- Contributions summary ---
  const cashGifts = contributions.filter(
    (c) => c.method !== 'in_kind' && c.method !== 'stock' && c.amount_cents !== null
  )
  const stockGifts = contributions.filter((c) => c.method === 'stock')
  const inKindCount = contributions.filter((c) => c.method === 'in_kind').length
  const totalCash = cashGifts.reduce((sum, c) => sum + (c.amount_cents ?? 0), 0)
  const stockFmv = stockGifts.reduce((sum, c) => sum + (c.amount_cents ?? 0), 0)
  const restrictedCash = cashGifts
    .filter((c) => c.restriction === 'donor_restricted')
    .reduce((sum, c) => sum + (c.amount_cents ?? 0), 0)
  const unrestrictedCash = totalCash - restrictedCash

  const byDonor = new Map<string, { name: string; gifts: number; total: number }>()
  for (const c of contributions) {
    const entry = byDonor.get(c.contact_id) ?? {
      name: c.contact?.display_name ?? 'Unknown donor',
      gifts: 0,
      total: 0,
    }
    entry.gifts += 1
    if (c.method !== 'in_kind' && c.amount_cents !== null) entry.total += c.amount_cents
    byDonor.set(c.contact_id, entry)
  }
  const donorRows = Array.from(byDonor.values()).sort((a, b) => b.total - a.total)

  // --- Grants paid rows ---
  const grantsPaidRows = groupGrantsPaid(paidDisbursements).map((g) => ({
    id: g.id,
    grantee: g.grantee?.display_name ?? 'Unknown grantee',
    ein: g.grantee?.tax_id ?? '—',
    taxStatus: g.grantee?.tax_status ? TAX_STATUS_LABELS[g.grantee.tax_status] : null,
    purpose: g.purpose ?? '—',
    amount: g.amount,
  }))
  const grantsPaidTotal = grantsPaidRows.reduce((sum, r) => sum + r.amount, 0)

  // --- Program-related investments (assets on Part X line 13, not grants) ---
  const priRows = pris
    .map((p) => ({
      id: p.id,
      recipient: p.recipient?.display_name ?? 'Unknown recipient',
      instrument: INSTRUMENT_LABELS[p.instrument],
      purpose: p.purpose ?? '—',
      fundedDate: p.funded_date,
      status: p.status,
      amount: p.amount_cents,
      held: p.status === 'funded' || p.status === 'converted',
    }))
    .sort((a, b) => b.amount - a.amount)
  const priHeldTotal = priRows.filter((r) => r.held).reduce((sum, r) => sum + r.amount, 0)

  // --- 1099 vendors ---
  const vendorRows = group1099Vendors(expenses1099).map(({ vendorId, vendor, total }) => ({
    id: vendorId || 'none',
    name: vendor?.display_name ?? '(No vendor recorded)',
    w9: vendorId ? (vendor?.w9_on_file ?? false) : null,
    total,
  }))

  const headerCell = 'py-2 pr-4 font-medium'
  const headerRow =
    'text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100'
  const bodyRow = 'border-b border-gray-50 hover:bg-gray-50'

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`Fiscal year ${fy} · ${formatDate(start)} to ${formatDate(inclusiveEnd(end))}`}
      >
        <CreateTicketButton />
        <div className="flex items-center gap-1">
          {fyOptions.map((option) => (
            <Link
              key={option}
              href={`/reports?fy=${option}${cyParam ? `&cy=${cy}` : ''}`}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                option === fy
                  ? 'bg-gray-900 text-white font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              FY{option}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="space-y-6">
        {/* Functional expenses */}
        <div className="card p-6">
          <SectionHeader title="Functional expenses" csvHref={`/api/exports/expenses?fy=${fy}`} />
          {expenseClasses.length === 0 ? (
            <p className="text-sm text-gray-400">No expenses recorded for this fiscal year.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={headerRow}>
                  <th className={headerCell}>Category</th>
                  <th className={headerCell}>990 line</th>
                  <th className="py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {expenseClasses.map(({ fc, rows, subtotal }) => (
                  <Fragment key={fc}>
                    {rows.map(({ category, total }) => (
                      <tr key={category.id} className={bodyRow}>
                        <td className="py-2.5 pr-4 text-gray-900">{category.name}</td>
                        <td className="py-2.5 pr-4 text-gray-500">
                          {category.form_990_line ?? '—'}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{formatCents(total)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <td className="py-2 pr-4 text-gray-600 font-medium" colSpan={2}>
                        {FUNCTIONAL_CLASS_LABELS[fc]} subtotal
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatCents(subtotal)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                <tr>
                  <td className="py-2.5 pr-4 font-semibold text-gray-900" colSpan={2}>
                    Total expenses
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">
                    {formatCents(expensesGrandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Contributions */}
        <div className="card p-6">
          <SectionHeader title="Contributions" csvHref={`/api/exports/contributions?fy=${fy}`} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total cash</p>
              <p className="text-lg font-semibold tabular-nums">{formatCents(totalCash)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Cash gifts</p>
              <p className="text-lg font-semibold tabular-nums">{cashGifts.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Stock FMV</p>
              <p className="text-lg font-semibold tabular-nums">{formatCents(stockFmv)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">In-kind gifts</p>
              <p className="text-lg font-semibold tabular-nums">{inKindCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Unrestricted</p>
              <p className="text-lg font-semibold tabular-nums">{formatCents(unrestrictedCash)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Restricted</p>
              <p className="text-lg font-semibold tabular-nums">{formatCents(restrictedCash)}</p>
            </div>
          </div>
          {donorRows.length === 0 ? (
            <p className="text-sm text-gray-400">No contributions recorded for this fiscal year.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={headerRow}>
                  <th className={headerCell}>Donor</th>
                  <th className="py-2 pr-4 font-medium text-right"># gifts</th>
                  <th className="py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {donorRows.map((row) => (
                  <tr key={row.name} className={bodyRow}>
                    <td className="py-2.5 pr-4 text-gray-900">{row.name}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{row.gifts}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatCents(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Grants paid */}
        <div className="card p-6">
          <SectionHeader
            title="Grants paid (990 Schedule I)"
            csvHref={`/api/exports/grants-paid?fy=${fy}`}
          />
          {grantsPaidRows.length === 0 ? (
            <p className="text-sm text-gray-400">No grants paid in this fiscal year.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={headerRow}>
                  <th className={headerCell}>Grantee</th>
                  <th className={headerCell}>EIN</th>
                  <th className={headerCell}>Tax status</th>
                  <th className={headerCell}>Purpose</th>
                  <th className="py-2 font-medium text-right">Amount disbursed</th>
                </tr>
              </thead>
              <tbody>
                {grantsPaidRows.map((row) => (
                  <tr key={row.id} className={bodyRow}>
                    <td className="py-2.5 pr-4 text-gray-900">{row.grantee}</td>
                    <td className="py-2.5 pr-4 text-gray-500">{row.ein}</td>
                    <td className="py-2.5 pr-4">
                      {row.taxStatus ?? <span className="text-red-600">Not determined</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600">{row.purpose}</td>
                    <td className="py-2.5 text-right tabular-nums">{formatCents(row.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2.5 pr-4 font-semibold text-gray-900" colSpan={4}>
                    Total
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">
                    {formatCents(grantsPaidTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Program-related investments */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-gray-900">
              Program-related investments (990 Part X line 13 / Schedule D Part VIII)
            </h2>
          </div>
          {priRows.length === 0 ? (
            <p className="text-sm text-gray-400">
              No program-related investments funded as of this fiscal year end.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={headerRow}>
                  <th className={headerCell}>Recipient</th>
                  <th className={headerCell}>Instrument</th>
                  <th className={headerCell}>Purpose</th>
                  <th className={headerCell}>Funded</th>
                  <th className={headerCell}>Status</th>
                  <th className="py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {priRows.map((row) => (
                  <tr key={row.id} className={bodyRow}>
                    <td className="py-2.5 pr-4 text-gray-900">{row.recipient}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{row.instrument}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{row.purpose}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{formatDate(row.fundedDate)}</td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{formatCents(row.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2.5 pr-4 font-semibold text-gray-900" colSpan={5}>
                    Held at cost (Part X line 13)
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">
                    {formatCents(priHeldTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="text-xs text-gray-400 mt-3">
            PRIs are assets, not expenses — they are excluded from functional expenses and
            Schedule I above. The held-at-cost total counts investments still on the books
            (funded or converted); repaid, exited, and written-off positions are listed for
            history only.
          </p>
        </div>

        {/* 1099 vendors */}
        <div className="card p-6">
          <SectionHeader
            title={`1099 vendors — calendar year ${cy}`}
            csvHref={`/api/exports/1099-vendors?cy=${cy}`}
          />
          <div className="flex items-center gap-1 mb-3 -mt-1">
            {cyOptions.map((option) => (
              <Link
                key={option}
                href={`/reports?fy=${fy}&cy=${option}`}
                className={`px-2.5 py-1 rounded-lg text-xs ${
                  option === cy ? 'bg-gray-900 text-white font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {option}
              </Link>
            ))}
          </div>
          {vendorRows.length === 0 ? (
            <p className="text-sm text-gray-400">
              No 1099-eligible payments recorded for calendar year {cy}.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={headerRow}>
                  <th className={headerCell}>Vendor</th>
                  <th className={headerCell}>W-9 on file</th>
                  <th className="py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {vendorRows.map((row) => (
                  <tr key={row.id} className={bodyRow}>
                    <td className="py-2.5 pr-4 text-gray-900">{row.name}</td>
                    <td className="py-2.5 pr-4">
                      {row.w9 === null ? (
                        <span className="text-gray-400">—</span>
                      ) : row.w9 ? (
                        <span className="text-green-700">Yes</span>
                      ) : (
                        <span className="text-red-600">No</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{formatCents(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-gray-400 mt-3">
            Vendors paid over $600 in a calendar year need a Form 1099-NEC. Card payments are
            excluded — the card processor reports those on Form 1099-K.
          </p>
        </div>
      </div>
    </div>
  )
}
