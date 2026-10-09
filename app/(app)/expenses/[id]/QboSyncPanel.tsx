import Link from 'next/link'
import { getConnection, getValidConnection } from '@/lib/quickbooks/client'
import { listPaymentAccounts, type QboAccount } from '@/lib/quickbooks/api'
import { createClient } from '@/lib/supabase/server'
import { awaitsBankPayment, canSendToQuickBooks } from '@/lib/expenses/payment'
import { getOrgSettings } from '@/lib/settings'
import { retryExpenseSync, sendExpenseToQuickBooks } from '@/lib/actions/quickbooks'
import SubmitButton from '@/components/SubmitButton'
import { formatDate, formatTimestamp } from '@/lib/utils/dates'
import type { Expense } from '@/lib/supabase/types/database'
import ActionForm from '@/components/ActionForm'

const badgeClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'

function Shell({ badge, children }: { badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-gray-900">QuickBooks</h2>
        {badge}
      </div>
      {children}
    </div>
  )
}

/**
 * Where this expense stands in QuickBooks. The app never creates QBO transactions
 * on its own (see lib/quickbooks/sync.ts): payments arrive through bank feeds
 * and are matched in Banking, and the app fills in their details.
 */
export default async function QboSyncPanel({ expense }: { expense: Expense }) {
  const connection = await getConnection()
  if (!connection) return null

  if (awaitsBankPayment(expense)) {
    return (
      <Shell badge={<span className={`${badgeClass} bg-yellow-100 text-yellow-800`}>Awaiting payment</span>}>
        <p className="text-xs text-gray-500 mt-1">
          Once the payment is accepted in QuickBooks it shows up in{' '}
          <Link href="/banking" className="underline hover:text-gray-900">
            Banking
          </Link>{' '}
          to match against this invoice. That marks it paid and fills in the payee, category, class
          and receipt on the QuickBooks transaction.
        </p>
      </Shell>
    )
  }

  const supabase = await createClient()
  const { timezone } = await getOrgSettings(supabase)

  // Came from a QuickBooks transaction that isn't a Purchase (a journal entry
  // or deposit approved in Banking): it's already on the books, so there's
  // nothing to send. sendExpenseToQbo refuses these too.
  if (!expense.qbo_purchase_id) {
    const { data: linked } = await supabase
      .from('qbo_inbox')
      .select('id, qbo_entity_type')
      .eq('expense_id', expense.id)
      .in('status', ['approved', 'auto_applied'])
      .limit(1)
    if (!canSendToQuickBooks(expense, (linked ?? []).length > 0)) {
      const entity = linked?.[0]?.qbo_entity_type
      return (
        <Shell badge={<span className={`${badgeClass} bg-green-100 text-green-800`}>From QuickBooks</span>}>
          <p className="text-xs text-gray-500 mt-1">
            This expense was recorded from a QuickBooks {entity ? entity.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : 'transaction'}{' '}
            in{' '}
            <Link href="/banking" className="underline hover:text-gray-900">
              Banking
            </Link>
            , so it&rsquo;s already in the books. It can&rsquo;t be sent again.
          </p>
        </Shell>
      )
    }
  }

  // Not in QuickBooks yet: either its bank payment hasn't been matched, or no
  // feed will ever bring it in and it has to be sent.
  if (!expense.qbo_purchase_id) {
    let accounts: QboAccount[] = []
    let accountsError: string | null = null
    try {
      const conn = await getValidConnection()
      if (conn) accounts = await listPaymentAccounts(conn)
    } catch (error) {
      accountsError = error instanceof Error ? error.message : 'Could not load QuickBooks accounts'
    }
    const { data: defaultMapping } = await supabase
      .from('qbo_mappings')
      .select('qbo_id')
      .eq('mapping_type', 'payment_method')
      .eq('local_key', expense.paid_by || expense.payment_method === 'reimbursement' ? 'reimbursement' : '_default')
      .maybeSingle()

    return (
      <Shell badge={<span className={`${badgeClass} bg-gray-100 text-gray-600`}>Not in QuickBooks</span>}>
        <p className="text-xs text-gray-500 mt-1">
          If this was paid from an account with a bank feed (the payroll account), it arrives in
          QuickBooks on its own and shows up in{' '}
          <Link href="/banking" className="underline hover:text-gray-900">
            Banking
          </Link>{' '}
          to link to this expense. Only send it from here if no bank feed will bring it in, for
          example a grant wired from the investment account or a reimbursement to a team member.
        </p>
        {expense.qbo_sync_status === 'failed' && expense.qbo_sync_error && (
          <p className="text-xs text-red-600 mt-2 break-words">{expense.qbo_sync_error}</p>
        )}
        {accountsError ? (
          <p className="text-xs text-red-600 mt-2">{accountsError}</p>
        ) : (
          <ActionForm
            action={sendExpenseToQuickBooks.bind(null, expense.id)}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <div>
              <label htmlFor="payment_account_id" className="block text-xs font-medium text-gray-600 mb-1">
                Paid from
              </label>
              <select
                id="payment_account_id"
                name="payment_account_id"
                required
                defaultValue={defaultMapping?.qbo_id ?? ''}
                className="input w-auto"
              >
                <option value="" disabled>
                  Pick an account…
                </option>
                {accounts.map((a) => (
                  <option key={a.Id} value={a.Id}>
                    {a.Name} ({a.AccountType})
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton className="btn btn-secondary" pendingLabel="Sending…">
              Send to QuickBooks
            </SubmitButton>
          </ActionForm>
        )}
      </Shell>
    )
  }

  const statusLine =
    expense.qbo_sync_status === 'failed' && expense.qbo_sync_error ? (
      <p className="text-xs text-red-600 mt-1 break-words">{expense.qbo_sync_error}</p>
    ) : expense.qbo_sync_status === 'synced' && expense.qbo_sync_error ? (
      // Informational note from the last fill-in (e.g. a split transaction).
      <p className="text-xs text-amber-700 mt-1 break-words">{expense.qbo_sync_error}</p>
    ) : null

  // Matched to a bank-feed transaction: the app fills in its details.
  if (expense.qbo_source === 'qbo') {
    const { data: payment } = await supabase
      .from('qbo_inbox')
      .select('txn_date')
      .eq('expense_id', expense.id)
      .eq('qbo_entity_id', expense.qbo_purchase_id)
      .in('status', ['approved', 'auto_applied'])
      .limit(1)
      .maybeSingle()

    return (
      <Shell
        badge={
          expense.qbo_sync_status === 'failed' ? (
            <span className={`${badgeClass} bg-red-100 text-red-800`}>Details not sent</span>
          ) : (
            <span className={`${badgeClass} bg-green-100 text-green-800`}>
              Matched{payment?.txn_date ? `, paid ${formatDate(payment.txn_date)}` : ''}
            </span>
          )
        }
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mt-1">
              Linked to bank transaction #{expense.qbo_purchase_id}. This expense&rsquo;s payee,
              category, class, description and receipts are copied onto it
              {expense.qbo_sync_status === 'synced' && expense.qbo_synced_at
                ? ` (last ${formatTimestamp(expense.qbo_synced_at, timezone)})`
                : ''}
              . The amount, date and bank account come from the bank and aren&rsquo;t changed.
            </p>
            {statusLine}
          </div>
          <ActionForm action={retryExpenseSync.bind(null, expense.id)} className="shrink-0">
            <SubmitButton className="btn btn-secondary">
              {expense.qbo_sync_status === 'failed' ? 'Retry' : 'Update QuickBooks'}
            </SubmitButton>
          </ActionForm>
        </div>
      </Shell>
    )
  }

  // Sent from this app: the app keeps it up to date (paid-from account stays as sent).
  return (
    <Shell
      badge={
        expense.qbo_sync_status === 'failed' ? (
          <span className={`${badgeClass} bg-red-100 text-red-800`}>Sync failed</span>
        ) : (
          <span className={`${badgeClass} bg-green-100 text-green-800`}>Sent from this app</span>
        )
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 mt-1">
            QuickBooks transaction #{expense.qbo_purchase_id}
            {expense.qbo_synced_at ? `, last updated ${formatTimestamp(expense.qbo_synced_at, timezone)}` : ''}. Edits
            here update it; the account it was paid from stays the same.
          </p>
          {statusLine}
        </div>
        <ActionForm action={retryExpenseSync.bind(null, expense.id)} className="shrink-0">
          <SubmitButton className="btn btn-secondary">Re-sync</SubmitButton>
        </ActionForm>
      </div>
    </Shell>
  )
}
