import { createClient } from '@/lib/supabase/server'
import SubmitButton from '@/components/SubmitButton'
import { withBasePath } from '@/lib/basePath'
import { getValidConnection, qboConfig } from '@/lib/quickbooks/client'
import {
  listClasses,
  listExpenseAccounts,
  listPaymentAccounts,
  type QboAccount,
  type QboClass,
} from '@/lib/quickbooks/api'
import Link from 'next/link'
import {
  disconnectQuickBooks,
  saveQboMappings,
  saveQboPullSettings,
} from '@/lib/actions/quickbooks'
import { formatTimestamp } from '@/lib/utils/dates'
import { getOrgSettings } from '@/lib/settings'
import {
  FUNCTIONAL_CLASS_LABELS,
  FUNCTIONAL_CLASS_ORDER,
} from '../expenses/functional-class'
import type { QboMapping } from '@/lib/supabase/types/database'
import ActionForm from '@/components/ActionForm'

const PAYMENT_METHOD_ROWS: { key: string; label: string }[] = [
  { key: 'card', label: 'Card' },
  { key: 'check', label: 'Check' },
  { key: 'ach', label: 'ACH' },
  { key: 'wire', label: 'Wire' },
  { key: 'reimbursement', label: 'Reimbursement' },
  { key: '_default', label: 'Default (no payment method set)' },
]

function accountValue(account: QboAccount): string {
  return `${account.Id}::${account.FullyQualifiedName}`
}

function selectedAccountValue(
  accounts: QboAccount[],
  mapping: QboMapping | undefined
): string {
  if (!mapping) return ''
  const account = accounts.find((a) => a.Id === mapping.qbo_id)
  return account ? accountValue(account) : ''
}

function AccountSelect({
  id,
  name,
  accounts,
  defaultValue,
}: {
  id: string
  name: string
  accounts: QboAccount[]
  defaultValue: string
}) {
  return (
    // Keyed by the saved value: React 19 resets uncontrolled selects to their
    // mount-time defaultValue after the form's server action runs, which made
    // saved mappings appear to revert to "Not mapped". A key change remounts
    // the select with the freshly-saved default.
    <select key={`${name}=${defaultValue}`} id={id} name={name} defaultValue={defaultValue} className="input">
      <option value="">— Not mapped —</option>
      {accounts.map((account) => (
        <option key={account.Id} value={accountValue(account)}>
          {account.FullyQualifiedName}
        </option>
      ))}
    </select>
  )
}

export default async function QuickBooksCard() {
  const cfg = qboConfig()
  if (!cfg) {
    return (
      <div className="card p-6">
        <h2 className="font-medium text-gray-900 mb-2">QuickBooks</h2>
        <p className="text-sm text-gray-400">
          Not configured. Set QBO_CLIENT_ID and QBO_CLIENT_SECRET in the environment.
        </p>
      </div>
    )
  }

  let connection = null
  let connectionError: string | null = null
  try {
    connection = await getValidConnection()
  } catch (error) {
    connectionError = error instanceof Error ? error.message : 'Connection error'
  }

  if (!connection) {
    return (
      <div className="card p-6">
        <h2 className="font-medium text-gray-900 mb-2">QuickBooks</h2>
        {connectionError ? (
          <p className="text-sm text-red-600 mb-3">{connectionError}</p>
        ) : (
          <p className="text-sm text-gray-500 mb-3">
            Connect your organization&apos;s QuickBooks company to keep expenses in step with
            the books and review bank-feed transactions here.
          </p>
        )}
        <a href={withBasePath('/api/quickbooks/connect')} className="btn btn-primary inline-block">
          Connect to QuickBooks
        </a>
        <p className="text-xs text-gray-400 mt-2">
          Environment: {cfg.environment}. You&apos;ll pick the company on Intuit&apos;s consent
          screen.
        </p>
      </div>
    )
  }

  // Connected — load QBO lists and current mappings for the mapping form.
  const supabase = await createClient()
  const { timezone } = await getOrgSettings(supabase)
  let expenseAccounts: QboAccount[] = []
  let paymentAccounts: QboAccount[] = []
  let classes: QboClass[] = []
  let listError: string | null = null
  try {
    ;[expenseAccounts, paymentAccounts, classes] = await Promise.all([
      listExpenseAccounts(connection),
      listPaymentAccounts(connection),
      listClasses(connection),
    ])
  } catch (error) {
    listError = error instanceof Error ? error.message : 'Failed to load QuickBooks data'
  }

  const [{ data: categories }, { data: mappingRows }, { data: syncState }] = await Promise.all([
    supabase.from('expense_categories').select('*').eq('is_active', true).order('name'),
    supabase.from('qbo_mappings').select('*'),
    supabase.from('qbo_sync_state').select('*').eq('id', 1).maybeSingle(),
  ])
  const mappings = new Map(
    (mappingRows ?? []).map((m) => [`${m.mapping_type}:${m.local_key}`, m])
  )

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="font-medium text-gray-900">QuickBooks</h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 shrink-0">
          Connected · {connection.environment}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        {connection.company_name ?? `Company ${connection.realm_id}`} · connected{' '}
        {formatTimestamp(connection.connected_at, timezone)}
      </p>

      {listError ? (
        <p className="text-sm text-red-600 mb-4">{listError}</p>
      ) : (
        <ActionForm action={saveQboMappings} successMessage="Mappings saved">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Expense categories → QuickBooks accounts
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-6">
            {(categories ?? []).map((category) => (
              <div key={category.id}>
                <label
                  htmlFor={`qbo-map-category-${category.id}`}
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  {category.name}
                </label>
                <AccountSelect
                  id={`qbo-map-category-${category.id}`}
                  name={`map:category:${category.id}`}
                  accounts={expenseAccounts}
                  defaultValue={selectedAccountValue(
                    expenseAccounts,
                    mappings.get(`category:${category.id}`)
                  )}
                />
              </div>
            ))}
          </div>

          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Functional classes → QuickBooks classes
          </h3>
          <p className="text-xs text-gray-400 mb-2">
            Requires class tracking (QuickBooks Plus). Leave unmapped to skip classes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 mb-6">
            {FUNCTIONAL_CLASS_ORDER.map((fc) => {
              const mapping = mappings.get(`functional_class:${fc}`)
              const selected = classes.find((c) => c.Id === mapping?.qbo_id)
              return (
                <div key={fc}>
                  <label
                    htmlFor={`qbo-map-functional-class-${fc}`}
                    className="block text-xs font-medium text-gray-600 mb-1"
                  >
                    {FUNCTIONAL_CLASS_LABELS[fc]}
                  </label>
                  <select
                    key={`map:functional_class:${fc}=${selected?.Id ?? ''}`}
                    id={`qbo-map-functional-class-${fc}`}
                    name={`map:functional_class:${fc}`}
                    defaultValue={selected ? `${selected.Id}::${selected.Name}` : ''}
                    className="input"
                  >
                    <option value="">— Not mapped —</option>
                    {classes.map((c) => (
                      <option key={c.Id} value={`${c.Id}::${c.Name}`}>
                        {c.Name}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>

          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Payment methods → paid-from accounts
          </h3>
          <p className="text-xs text-gray-400 mb-2">
            Which bank or card account each payment method draws from.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-6">
            {PAYMENT_METHOD_ROWS.map((row) => (
              <div key={row.key}>
                <label
                  htmlFor={`qbo-map-payment-method-${row.key}`}
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  {row.label}
                </label>
                <AccountSelect
                  id={`qbo-map-payment-method-${row.key}`}
                  name={`map:payment_method:${row.key}`}
                  accounts={paymentAccounts}
                  defaultValue={selectedAccountValue(
                    paymentAccounts,
                    mappings.get(`payment_method:${row.key}`)
                  )}
                />
              </div>
            ))}
          </div>

          <SubmitButton>Save mappings</SubmitButton>
        </ActionForm>
      )}

      {syncState && (
        <ActionForm action={saveQboPullSettings} successMessage="Settings saved" className="mt-6 pt-6 border-t border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 mb-1">
            Pull from QuickBooks (bank feed)
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            Every 30 minutes, transactions accepted in QuickBooks land in{' '}
            <Link href="/banking" className="underline">
              Banking
            </Link>{' '}
            for review. Bank-feed lines must be accepted in QuickBooks first (set up QuickBooks
            bank rules for recurring items so they flow through without manual work).
          </p>
          <div className="space-y-2 mb-3">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="pull_enabled"
                defaultChecked={syncState.pull_enabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>Pull transactions from QuickBooks</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="auto_apply_enabled"
                defaultChecked={syncState.auto_apply_enabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>
                Auto-apply exact matches
                <span className="block text-xs text-gray-400">
                  A transaction exactly matching a scheduled grant disbursement (amount + payee,
                  signed agreement on file) marks it paid automatically. Everything else always
                  waits for review.
                </span>
              </span>
            </label>
          </div>
          <div className="flex items-end gap-3 mb-3">
            <div>
              <label htmlFor="pull_since" className="block text-xs font-medium text-gray-600 mb-1">
                Pull transactions since
              </label>
              <input
                id="pull_since"
                type="date"
                name="pull_since"
                defaultValue={syncState.pull_since}
                className="input"
              />
            </div>
            <SubmitButton>Save pull settings</SubmitButton>
          </div>
          {syncState.last_run_at && (
            <p className="text-xs text-gray-400">
              Last run {formatTimestamp(syncState.last_run_at, timezone)} —{' '}
              {syncState.last_run_status === 'ok' ? 'ok' : `error: ${syncState.last_run_error}`}
            </p>
          )}
        </ActionForm>
      )}

      <ActionForm action={disconnectQuickBooks} className="mt-4 pt-4 border-t border-gray-100">
        <button
          type="submit"
          className="text-xs text-red-600 hover:text-red-700 hover:underline"
        >
          Disconnect QuickBooks
        </button>
      </ActionForm>
    </div>
  )
}
