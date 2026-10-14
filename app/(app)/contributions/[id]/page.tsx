import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import { formatCents, formatPerShareCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import type {
  AcknowledgementLetter,
  Attachment,
  Contact,
  Contribution,
  StockContributionDetail,
} from '@/lib/supabase/types/database'
import {
  computeStockValuation,
  getLatestCachedSecurityPrice,
} from '@/lib/market/security-prices'
import { METHOD_LABELS, VEHICLE_LABELS, VEHICLE_SPONSOR_LABELS } from '../methods'
import ContributionForm from '../new/ContributionForm'
import { fetchAll } from '@/lib/supabase/fetch-all'
import LetterPanel from './LetterPanel'
import { isEmailConfigured } from '@/lib/email/resend'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 text-right">{children}</dd>
    </div>
  )
}

function formatShares(shares: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
  }).format(shares)
}

function GainLoss({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="tabular-nums text-gray-400">—</span>
  const positive = cents >= 0
  return (
    <span className={`tabular-nums ${positive ? 'text-green-700' : 'text-red-600'}`}>
      {positive ? '+' : '-'}
      {formatCents(Math.abs(cents))}
    </span>
  )
}

export default async function ContributionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // One round trip: the donor is embedded, and everything else only needs the id
  const [contributionRes, letterRes, attachmentsRes, contacts, stockDetailRes] = await Promise.all([
    supabase
      .from('contributions')
      .select('*, contact:contacts!contact_id(id, display_name, email)')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('acknowledgement_letters')
      .select('*')
      .eq('contribution_id', id)
      .maybeSingle(),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'contribution')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    // Donor picker: every contact, past max_rows
    fetchAll<{ id: string; display_name: string }>(() =>
      supabase.from('contacts').select('id, display_name').order('display_name').order('id')
    ),
    supabase
      .from('stock_contribution_details')
      .select('*')
      .eq('contribution_id', id)
      .maybeSingle(),
  ])

  // Casts needed: hand-written interface row types resolve to `never` with supabase-js
  const contributionRow = contributionRes.data as unknown as
    | (Contribution & { contact: Pick<Contact, 'id' | 'display_name' | 'email'> | null })
    | null
  if (!contributionRow) notFound()
  const { contact, ...contribution } = contributionRow
  const letter = letterRes.data as unknown as AcknowledgementLetter | null
  const attachments = (attachmentsRes.data ?? []) as unknown as Attachment[]
  const stockDetail = stockDetailRes.data as unknown as StockContributionDetail | null

  // Mark-to-market estimate for stock gifts with a ticker (latest cached close).
  const latestPrice =
    contribution.method === 'stock' && stockDetail?.ticker_symbol
      ? await getLatestCachedSecurityPrice(supabase, stockDetail.ticker_symbol)
      : null
  const valuation =
    contribution.method === 'stock' && stockDetail
      ? computeStockValuation(stockDetail, latestPrice)
      : null

  const letterSent = letter?.status === 'sent'

  return (
    <div>
      <PageHeader
        title={`Contribution from ${contact?.display_name ?? 'Unknown donor'}`}
        description={`Received ${formatDate(contribution.received_date)}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h2 className="font-medium text-gray-900 mb-3">Details</h2>
            <dl>
              <DetailRow label="Donor">
                {contact ? (
                  <Link href={`/contacts/${contact.id}`} className="hover:underline">
                    {contact.display_name}
                  </Link>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label="Amount">
                <span className="tabular-nums">
                  {contribution.method === 'in_kind' && contribution.amount_cents === null
                    ? 'In-kind'
                    : formatCents(contribution.amount_cents)}
                </span>
              </DetailRow>
              <DetailRow label="Received date">{formatDate(contribution.received_date)}</DetailRow>
              <DetailRow label="Method">{METHOD_LABELS[contribution.method]}</DetailRow>
              <DetailRow label="Giving vehicle">{VEHICLE_LABELS[contribution.vehicle]}</DetailRow>
              {contribution.vehicle_sponsor_name && (
                <DetailRow
                  label={VEHICLE_SPONSOR_LABELS[contribution.vehicle] ?? 'Sponsoring organization'}
                >
                  {contribution.vehicle_sponsor_name}
                </DetailRow>
              )}
              {contribution.method === 'in_kind' && (
                <DetailRow label="In-kind description">
                  {contribution.in_kind_description ?? '—'}
                </DetailRow>
              )}
              {contribution.method === 'stock' && stockDetail && (
                <>
                  <DetailRow label="Security">{stockDetail.security_name}</DetailRow>
                  <DetailRow label="Ticker">{stockDetail.ticker_symbol ?? '—'}</DetailRow>
                  <DetailRow label="Shares">{formatShares(stockDetail.shares)}</DetailRow>
                  <DetailRow label="Valuation date">
                    {formatDate(stockDetail.valuation_date)}
                  </DetailRow>
                  <DetailRow label="FMV per share">
                    <span className="tabular-nums">
                      {formatPerShareCents(stockDetail.fmv_per_share_cents)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Valuation source">
                    {stockDetail.valuation_source.replace(/_/g, ' ')}
                  </DetailRow>
                  {stockDetail.market_price_source && (
                    <DetailRow label="Market data source">
                      {stockDetail.market_price_source.toUpperCase()}
                    </DetailRow>
                  )}
                  {stockDetail.sale_date && (
                    <>
                      <DetailRow label="Sale date">{formatDate(stockDetail.sale_date)}</DetailRow>
                      <DetailRow label="Net sale proceeds">
                        <span className="tabular-nums">
                          {formatCents(stockDetail.sale_net_cents)}
                        </span>
                      </DetailRow>
                    </>
                  )}
                </>
              )}
              <DetailRow label="Restriction">
                {contribution.restriction === 'donor_restricted' ? 'Donor restricted' : 'Unrestricted'}
              </DetailRow>
              {contribution.restriction_purpose && (
                <DetailRow label="Restriction purpose">
                  {contribution.restriction_purpose}
                </DetailRow>
              )}
              {contribution.quid_pro_quo && (
                <>
                  <DetailRow label="Goods/services provided">
                    {contribution.goods_services_description ?? '—'}
                  </DetailRow>
                  <DetailRow label="Goods/services value">
                    <span className="tabular-nums">
                      {formatCents(contribution.goods_services_value_cents)}
                    </span>
                  </DetailRow>
                </>
              )}
              {contribution.check_number && (
                <DetailRow label="Check number">{contribution.check_number}</DetailRow>
              )}
              {contribution.notes && <DetailRow label="Notes">{contribution.notes}</DetailRow>}
            </dl>
          </div>

          {valuation && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-medium text-gray-900">Current value</h2>
                <span className="text-[11px] uppercase tracking-wide text-gray-400">Estimate</span>
              </div>
              {valuation.held ? (
                valuation.latestCloseCents !== null ? (
                  <dl>
                    <DetailRow label="Latest close">
                      <span className="tabular-nums">{formatCents(valuation.latestCloseCents)}</span>
                      {valuation.latestCloseDate && (
                        <span className="text-gray-400">
                          {' '}
                          as of {formatDate(valuation.latestCloseDate)}
                        </span>
                      )}
                    </DetailRow>
                    <DetailRow label="Estimated current value">
                      <span className="tabular-nums">{formatCents(valuation.currentValueCents)}</span>
                    </DetailRow>
                    <DetailRow label="FMV at receipt">
                      <span className="tabular-nums">{formatCents(valuation.fmvTotalCents)}</span>
                    </DetailRow>
                    <DetailRow label="Unrealized gain/loss">
                      <GainLoss cents={valuation.unrealizedGainLossCents} />
                    </DetailRow>
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500 mt-2">
                    No market price cached yet. The daily price job fills this in once it runs
                    (requires an FMP API key).
                  </p>
                )
              ) : (
                <dl>
                  <DetailRow label="Net sale proceeds">
                    <span className="tabular-nums">{formatCents(valuation.saleNetCents)}</span>
                  </DetailRow>
                  <DetailRow label="FMV at receipt">
                    <span className="tabular-nums">{formatCents(valuation.fmvTotalCents)}</span>
                  </DetailRow>
                  <DetailRow label="Realized gain/loss">
                    <GainLoss cents={valuation.realizedGainLossCents} />
                  </DetailRow>
                </dl>
              )}
              <p className="mt-3 text-xs text-gray-400">
                Market figures are estimates from cached end-of-day prices, not a valuation for tax
                purposes.
              </p>
            </div>
          )}

          {letterSent ? (
            <div className="card p-5 text-sm text-gray-500">
              Locked — the acknowledgement letter has been sent, so this contribution can no
              longer be edited.
            </div>
          ) : (
            <div>
              <h2 className="font-medium text-gray-900 mb-3">Edit contribution</h2>
              <ContributionForm
                contacts={contacts}
                contribution={contribution}
                stockDetail={stockDetail}
              />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <LetterPanel
            contributionId={contribution.id}
            letter={
              letter
                ? {
                    status: letter.status,
                    sent_at: letter.sent_at,
                    sent_to_email: letter.sent_to_email,
                  }
                : null
            }
            hasEmail={Boolean(contact?.email)}
            emailEnabled={isDemoMode() || isEmailConfigured()}
            emailDemo={isDemoMode()}
          />
          <AttachmentsPanel
            entityType="contribution"
            entityId={contribution.id}
            attachments={attachments}
            revalidatePath={`/contributions/${contribution.id}`}
          />
        </div>
      </div>
    </div>
  )
}
