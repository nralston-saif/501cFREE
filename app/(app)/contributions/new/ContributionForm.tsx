'use client'

import { useState, useTransition } from 'react'
import { createContribution, updateContribution } from '@/lib/actions/contributions'
import MoneyInput from '@/components/MoneyInput'
import ContactSelect from '@/components/ContactSelect'
import { useToast } from '@/components/Toast'
import { centsToDollarString, centsToPerShareString } from '@/lib/utils/money'
import { todayISO } from '@/lib/utils/dates'
import type {
  Contribution,
  ContributionMethod,
  ContributionVehicle,
  Restriction,
  StockContributionDetail,
  StockValuationSource,
} from '@/lib/supabase/types/database'
import {
  METHOD_LABELS,
  VEHICLE_LABELS,
  VEHICLE_SPONSOR_LABELS,
  vehicleForbidsQuidProQuo,
} from '../methods'
import { unwrap } from '@/lib/actions/result'

interface ContributionFormProps {
  contacts: { id: string; display_name: string }[]
  /** When provided the form edits this contribution instead of creating one. */
  contribution?: Contribution
  stockDetail?: StockContributionDetail | null
}

function isNextRedirect(err: unknown): boolean {
  return Boolean(
    (err as Error & { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-gray-600 mb-1">{children}</span>
}

/** Total FMV in dollars from a shares × per-share pair, or '' if either is blank/invalid. */
function computeTotal(sharesStr: string, perShareStr: string): string {
  if (perShareStr.trim() === '' || sharesStr.trim() === '') return ''
  const s = Number(sharesStr.replace(/,/g, ''))
  const p = Number(perShareStr.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(s) || !Number.isFinite(p) || s <= 0) return ''
  return (s * p).toFixed(2)
}

export default function ContributionForm({
  contacts,
  contribution,
  stockDetail,
}: ContributionFormProps) {
  const [method, setMethod] = useState<ContributionMethod>(contribution?.method ?? 'check')
  const [vehicle, setVehicle] = useState<ContributionVehicle>(contribution?.vehicle ?? 'direct')
  const [restriction, setRestriction] = useState<Restriction>(
    contribution?.restriction ?? 'unrestricted'
  )
  const [quidProQuo, setQuidProQuo] = useState(contribution?.quid_pro_quo ?? false)

  const handleVehicleChange = (value: ContributionVehicle) => {
    setVehicle(value)
    if (vehicleForbidsQuidProQuo(value)) setQuidProQuo(false)
  }
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  // Stock FMV fields are coupled: total = shares × per-share. Keep them in state
  // so editing the per-share price (or shares) re-derives the displayed total.
  const initialShares = stockDetail?.shares != null ? String(stockDetail.shares) : ''
  const initialPerShare = centsToPerShareString(stockDetail?.fmv_per_share_cents)
  const [shares, setShares] = useState(initialShares)
  const [perShare, setPerShare] = useState(initialPerShare)
  const [amount, setAmount] = useState(
    contribution?.method === 'stock' && initialPerShare.trim() !== ''
      ? computeTotal(initialShares, initialPerShare)
      : centsToDollarString(contribution?.amount_cents)
  )

  const handleSharesChange = (value: string) => {
    setShares(value)
    if (perShare.trim() !== '') setAmount(computeTotal(value, perShare))
  }

  const handlePerShareChange = (value: string) => {
    setPerShare(value)
    if (value.trim() !== '') setAmount(computeTotal(shares, value))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      try {
        if (contribution) {
          unwrap(await updateContribution(contribution.id, formData))
          showToast('Contribution updated', 'success')
        } else {
          unwrap(await createContribution(formData))
        }
      } catch (err) {
        // createContribution redirects on success; redirect() throws and must
        // be rethrown so Next can perform the navigation
        if (isNextRedirect(err)) throw err
        showToast(err instanceof Error ? err.message : 'Could not save contribution', 'error')
      }
    })
  }

  const inKind = method === 'in_kind'
  const stock = method === 'stock'

  return (
    <form onSubmit={handleSubmit} className="card p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block sm:col-span-2">
          <Label>Donor *</Label>
          <ContactSelect
            name="contact_id"
            contacts={contacts}
            defaultValue={contribution?.contact_id}
            required
          />
        </label>

        <label className="block">
          <Label>Received date *</Label>
          <input
            type="date"
            name="received_date"
            required
            defaultValue={contribution?.received_date ?? todayISO()}
            className="input"
          />
        </label>

        <label className="block">
          <Label>Method *</Label>
          <select
            name="method"
            required
            value={method}
            onChange={(e) => setMethod(e.target.value as ContributionMethod)}
            className="input"
          >
            {(Object.keys(METHOD_LABELS) as ContributionMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <Label>
            {inKind
              ? 'Fair-market value (optional)'
              : stock
                ? 'Total FMV'
                : 'Amount *'}
          </Label>
          <MoneyInput
            name="amount"
            required={!inKind && !stock}
            value={amount}
            onChange={setAmount}
            readOnly={stock && perShare.trim() !== ''}
          />
          {stock && perShare.trim() !== '' && (
            <span className="mt-1 block text-xs text-gray-500">
              Computed from shares × FMV per share. Clear the per-share price to enter a total
              directly.
            </span>
          )}
        </label>

        {method === 'check' && (
          <label className="block">
            <Label>Check number</Label>
            <input
              name="check_number"
              defaultValue={contribution?.check_number ?? ''}
              className="input"
            />
          </label>
        )}

        <label className="block">
          <Label>Giving vehicle *</Label>
          <select
            name="vehicle"
            required
            value={vehicle}
            onChange={(e) => handleVehicleChange(e.target.value as ContributionVehicle)}
            className="input"
          >
            {(Object.keys(VEHICLE_LABELS) as ContributionVehicle[]).map((v) => (
              <option key={v} value={v}>
                {VEHICLE_LABELS[v]}
              </option>
            ))}
          </select>
        </label>

        {vehicle !== 'direct' && (
          <label className="block">
            <Label>
              {VEHICLE_SPONSOR_LABELS[vehicle]}
              {vehicle === 'daf' ? ' *' : ''}
            </Label>
            <input
              name="vehicle_sponsor_name"
              required={vehicle === 'daf'}
              defaultValue={contribution?.vehicle_sponsor_name ?? ''}
              className="input"
              placeholder={vehicle === 'daf' ? 'e.g. Fidelity Charitable' : ''}
            />
            {vehicle === 'daf' && (
              <span className="mt-1 block text-xs text-gray-500">
                The sponsoring organization is the legal donor of record; the contact above is the
                advising donor.
              </span>
            )}
          </label>
        )}

        {inKind && (
          <label className="block sm:col-span-2">
            <Label>Description of donated property *</Label>
            <textarea
              name="in_kind_description"
              required
              rows={3}
              defaultValue={contribution?.in_kind_description ?? ''}
              className="input"
              placeholder="Describe the donated goods or property (do not assign a value in the letter)"
            />
          </label>
        )}

        {stock && (
          <div className="sm:col-span-2 rounded-lg bg-gray-50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <Label>Security name *</Label>
              <input
                name="stock_security_name"
                required
                defaultValue={stockDetail?.security_name ?? ''}
                className="input"
                placeholder="e.g. Apple Inc. common stock"
              />
            </label>

            <label className="block">
              <Label>Ticker</Label>
              <input
                name="stock_ticker_symbol"
                defaultValue={stockDetail?.ticker_symbol ?? ''}
                className="input uppercase"
                placeholder="AAPL"
              />
            </label>

            <label className="block">
              <Label>CUSIP</Label>
              <input
                name="stock_cusip"
                defaultValue={stockDetail?.cusip ?? ''}
                className="input"
              />
            </label>

            <label className="block">
              <Label>Shares *</Label>
              <input
                name="stock_shares"
                type="number"
                min="0"
                step="0.000001"
                required
                value={shares}
                onChange={(e) => handleSharesChange(e.target.value)}
                className="input"
              />
            </label>

            <label className="block">
              <Label>Valuation date</Label>
              <input
                name="stock_valuation_date"
                type="date"
                defaultValue={stockDetail?.valuation_date ?? contribution?.received_date ?? todayISO()}
                className="input"
              />
            </label>

            <label className="block">
              <Label>FMV per share</Label>
              <MoneyInput
                name="stock_fmv_per_share"
                value={perShare}
                onChange={handlePerShareChange}
                maxDecimals={6}
              />
            </label>

            <label className="block">
              <Label>Valuation source</Label>
              <select
                name="stock_valuation_source"
                defaultValue={stockDetail?.valuation_source ?? 'manual'}
                className="input"
              >
                {(['manual', 'broker_statement', 'api_estimate'] as StockValuationSource[]).map(
                  (source) => (
                    <option key={source} value={source}>
                      {source.replace(/_/g, ' ')}
                    </option>
                  )
                )}
              </select>
            </label>

            <label className="block">
              <Label>Transfer received</Label>
              <input
                name="stock_transfer_received_date"
                type="date"
                defaultValue={
                  stockDetail?.transfer_received_date ?? contribution?.received_date ?? todayISO()
                }
                className="input"
              />
            </label>

            <label className="block">
              <Label>Brokerage account</Label>
              <input
                name="stock_brokerage_account"
                defaultValue={stockDetail?.brokerage_account ?? ''}
                className="input"
              />
            </label>

            <label className="block">
              <Label>Sale date</Label>
              <input
                name="stock_sale_date"
                type="date"
                defaultValue={stockDetail?.sale_date ?? ''}
                className="input"
              />
            </label>

            <label className="block">
              <Label>Gross sale proceeds</Label>
              <MoneyInput
                name="stock_sale_gross"
                defaultValue={centsToDollarString(stockDetail?.sale_gross_cents)}
              />
            </label>

            <label className="block">
              <Label>Sale fees</Label>
              <MoneyInput
                name="stock_sale_fees"
                defaultValue={centsToDollarString(stockDetail?.sale_fees_cents)}
              />
            </label>

            <label className="block">
              <Label>Net sale proceeds</Label>
              <MoneyInput
                name="stock_sale_net"
                defaultValue={centsToDollarString(stockDetail?.sale_net_cents)}
              />
            </label>

            <label className="block sm:col-span-2">
              <Label>Stock notes</Label>
              <textarea
                name="stock_notes"
                rows={3}
                defaultValue={stockDetail?.notes ?? ''}
                className="input"
              />
            </label>
          </div>
        )}

        <label className="block">
          <Label>Restriction</Label>
          <select
            name="restriction"
            value={restriction}
            onChange={(e) => setRestriction(e.target.value as Restriction)}
            className="input"
          >
            <option value="unrestricted">Unrestricted</option>
            <option value="donor_restricted">Donor restricted</option>
          </select>
        </label>

        {restriction === 'donor_restricted' && (
          <label className="block">
            <Label>Restriction purpose</Label>
            <input
              name="restriction_purpose"
              defaultValue={contribution?.restriction_purpose ?? ''}
              className="input"
              placeholder="e.g. Summer reading program"
            />
          </label>
        )}

        {vehicleForbidsQuidProQuo(vehicle) ? (
          <p className="sm:col-span-2 mt-1 text-xs text-gray-500">
            {vehicle === 'daf'
              ? 'DAF grants cannot provide goods or services to the advising donor (IRC 4967), so quid pro quo does not apply.'
              : 'An IRA qualified charitable distribution is disqualified by any return benefit, so quid pro quo does not apply.'}
          </p>
        ) : (
          <label className="flex items-start gap-2 sm:col-span-2 mt-1">
            <input
              type="checkbox"
              name="quid_pro_quo"
              checked={quidProQuo}
              onChange={(e) => setQuidProQuo(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              Donor received goods or services in exchange (quid pro quo)
            </span>
          </label>
        )}

        {quidProQuo && (
          <div className="sm:col-span-2 rounded-lg bg-gray-50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <p className="text-xs text-gray-500 sm:col-span-2">
              Required by the IRS for payments over $75 where the donor receives goods or
              services. The acknowledgement letter must describe them and state their
              good-faith value.
            </p>
            <label className="block sm:col-span-2">
              <Label>Description of goods/services *</Label>
              <input
                name="goods_services_description"
                required
                defaultValue={contribution?.goods_services_description ?? ''}
                className="input"
                placeholder="e.g. Gala dinner ticket"
              />
            </label>
            <label className="block">
              <Label>Good-faith value *</Label>
              <MoneyInput
                name="goods_services_value"
                required
                defaultValue={centsToDollarString(contribution?.goods_services_value_cents)}
              />
            </label>
          </div>
        )}

        <label className="block sm:col-span-2">
          <Label>Notes</Label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={contribution?.notes ?? ''}
            className="input"
          />
        </label>
      </div>

      <div className="mt-6 flex justify-end">
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? 'Saving…' : contribution ? 'Save changes' : 'Record contribution'}
        </button>
      </div>
    </form>
  )
}
