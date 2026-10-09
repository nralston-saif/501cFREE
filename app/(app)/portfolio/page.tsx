import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { formatCents } from '@/lib/utils/money'
import { formatDate, todayInTimeZone } from '@/lib/utils/dates'
import { getOrgSettings, orgName } from '@/lib/settings'
import { loadProgramAreas, programAreaLabel } from '@/lib/program-areas'
import { TAX_STATUS_LABELS } from '@/lib/utils/tax-status'
import { INSTRUMENT_LABELS } from '../pris/instruments'
import type { ContactTaxStatus, GrantOut, GranteeReportStatus, Pri } from '@/lib/supabase/types/database'
import { fetchAll } from '@/lib/supabase/fetch-all'
import CreateTicketButton from '@/components/CreateTicketButton'

// Grantee-centric view of everything the organization has funded: grants
// grouped by grantee (cumulative awarded vs disbursed, program areas, report
// health) plus
// program-related investments. Read-only — the operational ledger stays on
// /grants-out and /pris.

type GranteeGroup = {
  contactId: string
  name: string
  taxStatus: string | null
  /** Program-area slugs across the grantee's awarded proposals */
  programAreas: string[]
  awarded: number
  disbursed: number
  hasActive: boolean
  overdueReports: number
  awards: GrantOut[]
}

type AwardRow = GrantOut & {
  grantee: { display_name: string; tax_status: ContactTaxStatus | null } | null
  proposal: { program_areas: string[] } | null
}

type PriRow = Pick<
  Pri,
  'id' | 'recipient_contact_id' | 'purpose' | 'amount_cents' | 'instrument' | 'funded_date' | 'status'
> & { recipient: { display_name: string } | null }

function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
      <div className="h-full rounded-full bg-gray-900" style={{ width: `${pct}%` }} />
    </div>
  )
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const settings = await getOrgSettings(supabase)
  const today = todayInTimeZone(settings.timezone)

  // Every row (the page sums them), paged past max_rows; grantee, proposal
  // and recipient details come from foreign-key embeds.
  const [awards, disbursements, reports, pris, programAreas] = await Promise.all([
    fetchAll<AwardRow>(() =>
      supabase
        .from('grants_out')
        .select(
          '*, grantee:contacts!grantee_contact_id(display_name, tax_status), ' +
            'proposal:grant_proposals!proposal_id(program_areas)'
        )
        .order('award_date', { ascending: false })
        .order('id')
    ),
    fetchAll<{ grant_out_id: string; amount_cents: number }>(() =>
      supabase.from('disbursements').select('grant_out_id, amount_cents').eq('status', 'paid').order('id')
    ),
    fetchAll<{ grant_out_id: string; status: GranteeReportStatus; due_date: string }>(() =>
      supabase.from('grantee_reports').select('grant_out_id, status, due_date').order('id')
    ),
    fetchAll<PriRow>(() =>
      supabase
        .from('pris')
        .select(
          'id, recipient_contact_id, purpose, amount_cents, instrument, funded_date, status, ' +
            'recipient:contacts!recipient_contact_id(display_name)'
        )
        .order('investment_date', { ascending: false })
        .order('id')
    ),
    loadProgramAreas(supabase),
  ])

  const paidByAward = new Map<string, number>()
  for (const d of disbursements) {
    paidByAward.set(d.grant_out_id, (paidByAward.get(d.grant_out_id) ?? 0) + d.amount_cents)
  }

  const overdueByAward = new Map<string, number>()
  for (const r of reports) {
    const overdue =
      r.status === 'overdue' || (r.status === 'upcoming' && r.due_date < today)
    if (!overdue) continue
    overdueByAward.set(r.grant_out_id, (overdueByAward.get(r.grant_out_id) ?? 0) + 1)
  }

  // Group awards by grantee org — the unit of this page is the relationship,
  // not the individual award.
  const groups = new Map<string, GranteeGroup>()
  for (const { grantee: contact, proposal, ...award } of awards) {
    let group = groups.get(award.grantee_contact_id)
    if (!group) {
      const taxStatus = contact?.tax_status ?? null
      group = {
        contactId: award.grantee_contact_id,
        name: contact?.display_name ?? 'Unknown grantee',
        taxStatus: taxStatus ? TAX_STATUS_LABELS[taxStatus] : null,
        programAreas: [],
        awarded: 0,
        disbursed: 0,
        hasActive: false,
        overdueReports: 0,
        awards: [],
      }
      groups.set(award.grantee_contact_id, group)
    }
    group.awarded += award.amount_awarded_cents
    group.disbursed += paidByAward.get(award.id) ?? 0
    group.hasActive ||= award.status === 'awarded' || award.status === 'active'
    group.overdueReports += overdueByAward.get(award.id) ?? 0
    group.awards.push(award)
    if (award.proposal_id) {
      for (const slug of proposal?.program_areas ?? []) {
        if (!group.programAreas.includes(slug)) group.programAreas.push(slug)
      }
    }
  }
  const grantees = [...groups.values()].sort((a, b) => b.awarded - a.awarded)

  const totalGranted = grantees.reduce((sum, g) => sum + g.awarded, 0)
  const totalDisbursed = grantees.reduce((sum, g) => sum + g.disbursed, 0)
  const deployedPris = pris.filter((p) =>
    ['committed', 'funded', 'converted'].includes(p.status)
  )
  const priCapital = deployedPris.reduce((sum, p) => sum + p.amount_cents, 0)
  const orgsFunded = new Set([
    ...grantees.map((g) => g.contactId),
    ...pris.map((p) => p.recipient_contact_id),
  ]).size

  const stats = [
    { label: 'Total granted', value: formatCents(totalGranted) },
    { label: 'Disbursed to date', value: formatCents(totalDisbursed) },
    { label: 'PRI capital deployed', value: formatCents(priCapital) },
    { label: 'Organizations funded', value: String(orgsFunded) },
  ]

  return (
    <div>
      <PageHeader
        title="Portfolio"
        description={`Everything ${orgName(settings)} has funded — grants by grantee, plus program-related investments.`}
      >
        <CreateTicketButton />
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{stat.label}</p>
            <p className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-700 mb-3">
          Grantees <span className="text-gray-400 tabular-nums">({grantees.length})</span>
        </h2>
        {grantees.length === 0 ? (
          <EmptyState message="No grants awarded yet. Approved proposals will appear here." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {grantees.map((g) => (
              <div key={g.contactId} className="card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/contacts/${g.contactId}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {g.name}
                    </Link>
                    {g.taxStatus && <p className="text-xs text-gray-500 mt-0.5">{g.taxStatus}</p>}
                  </div>
                  {g.hasActive && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Active
                    </span>
                  )}
                </div>

                {g.programAreas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {g.programAreas.map((slug) => (
                      <span
                        key={slug}
                        className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
                      >
                        {programAreaLabel(programAreas, slug)}
                      </span>
                    ))}
                  </div>
                )}

                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-lg font-semibold text-gray-900 tabular-nums">
                      {formatCents(g.awarded)}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {formatCents(g.disbursed)} disbursed
                    </span>
                  </div>
                  <Meter value={g.disbursed} max={g.awarded} />
                </div>

                {g.overdueReports > 0 && (
                  <p className="text-xs font-medium text-amber-700">
                    {g.overdueReports} grantee report{g.overdueReports > 1 ? 's' : ''} overdue
                  </p>
                )}

                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {g.awards.map((a) => (
                    <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/grants-out/awards/${a.id}`}
                          className="block text-sm text-gray-900 hover:underline truncate"
                        >
                          {a.purpose ?? 'Grant'}
                        </Link>
                        <span className="block text-xs text-gray-400">
                          {formatDate(a.award_date)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm text-gray-700 tabular-nums">
                          {formatCents(a.amount_awarded_cents)}
                        </span>
                        <StatusBadge status={a.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-700 mb-3">
          Program-related investments{' '}
          <span className="text-gray-400 tabular-nums">({pris.length})</span>
        </h2>
        {pris.length === 0 ? (
          <EmptyState message="No PRIs yet. Mission-aligned investments will appear here." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pris.map((pri) => (
              <div key={pri.id} className="card relative p-5 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <Link
                    href={`/pris/${pri.id}`}
                    className="font-medium text-gray-900 hover:underline before:absolute before:inset-0 before:content-['']"
                  >
                    {pri.recipient?.display_name ?? 'Unknown recipient'}
                  </Link>
                  <StatusBadge status={pri.status} />
                </div>
                {pri.purpose && <p className="text-sm text-gray-600 mb-2">{pri.purpose}</p>}
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatCents(pri.amount_cents)}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{INSTRUMENT_LABELS[pri.instrument]}</span>
                  {pri.funded_date && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Funded {formatDate(pri.funded_date)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
