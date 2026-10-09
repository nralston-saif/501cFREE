import Link from 'next/link'
import SubmitButton from '@/components/SubmitButton'
import ContactSelect from '@/components/ContactSelect'
import MoneyInput from '@/components/MoneyInput'
import ExpenseFormFields from '../expenses/ExpenseFormFields'
import SuggestionActions from './SuggestionActions'
import {
  acceptInvoicePayment,
  acceptPriFunding,
  approveAsContribution,
  approveAsExpense,
  dismissItem,
} from '@/lib/actions/qbo-inbox'
import { formatCents, centsToDollarString } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import type { InvoiceMatch, Suggestion } from '@/lib/quickbooks/match'
import type { QboTxnLine } from '@/lib/quickbooks/api'
import type {
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
  QboInboxItem,
} from '@/lib/supabase/types/database'
import ActionForm from '@/components/ActionForm'

export type DetailProps = {
  item: QboInboxItem
  categories: ExpenseCategory[]
  vendors: { id: string; display_name: string }[]
  contacts: { id: string; display_name: string }[]
  teamMembers: { id: string; full_name: string }[]
}

const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

function rawField(raw: unknown, key: string): unknown {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)[key]
    : undefined
}

function rawAmountCents(raw: unknown): number | null {
  const amount = rawField(raw, 'TotalAmt') ?? rawField(raw, 'Amount')
  return typeof amount === 'number' ? Math.round(amount * 100) : null
}

function rawLines(raw: unknown): QboTxnLine[] {
  const lines = rawField(raw, 'Line')
  return Array.isArray(lines) ? (lines as QboTxnLine[]) : []
}

export default function InboxItemDetail({
  item,
  categories,
  vendors,
  contacts,
  teamMembers,
}: DetailProps) {
  const suggestion = (item.suggestion as unknown as Suggestion) ?? null

  return (
    <div className="space-y-4">
      <Facts item={item} />
      {item.status === 'pending' ? (
        <PendingPanels
          item={item}
          suggestion={suggestion}
          categories={categories}
          vendors={vendors}
          contacts={contacts}
          teamMembers={teamMembers}
        />
      ) : (
        <ResolvedPanel item={item} />
      )}
    </div>
  )
}

function Facts({ item }: { item: QboInboxItem }) {
  const lines = rawLines(item.raw)
  const showLines =
    (item.qbo_entity_type === 'Deposit' || item.qbo_entity_type === 'JournalEntry') &&
    lines.length > 1

  return (
    <div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500 uppercase tracking-wide">QBO id</dt>
          <dd className="text-gray-900">
            {item.qbo_entity_type} #{item.qbo_entity_id}
          </dd>
        </div>
        {item.qbo_doc_number && (
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">Doc #</dt>
            <dd className="text-gray-900">{item.qbo_doc_number}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-gray-500 uppercase tracking-wide">First seen</dt>
          <dd className="text-gray-900">{formatDate(item.first_seen_at.slice(0, 10))}</dd>
        </div>
        {item.qbo_private_note && (
          <div className="col-span-2">
            <dt className="text-xs text-gray-500 uppercase tracking-wide">QBO memo</dt>
            <dd className="text-gray-900 break-words">{item.qbo_private_note}</dd>
          </div>
        )}
      </dl>
      {showLines && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
            Lines ({lines.length})
          </p>
          <ul className="text-sm text-gray-700 space-y-0.5">
            {lines.map((line, i) => (
              <li key={line.Id ?? i} className="flex justify-between gap-4">
                <span className="truncate">
                  {line.DepositLineDetail?.Entity?.name ??
                    line.JournalEntryLineDetail?.AccountRef?.name ??
                    line.Description ??
                    `Line ${i + 1}`}
                  {line.JournalEntryLineDetail?.PostingType
                    ? ` (${line.JournalEntryLineDetail.PostingType.toLowerCase()})`
                    : ''}
                </span>
                <span className="tabular-nums whitespace-nowrap">
                  {typeof line.Amount === 'number'
                    ? formatCents(Math.round(line.Amount * 100))
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function PendingPanels({
  item,
  suggestion,
  categories,
  vendors,
  contacts,
  teamMembers,
}: DetailProps & { suggestion: Suggestion | null }) {
  if (item.kind === 'deleted') return <DeletedPanel item={item} />
  if (item.kind === 'changed') return <ChangedPanel item={item} />

  return (
    <div className="space-y-4">
      {suggestion?.type === 'disbursement_paid' && (
        <SuggestionCard reason={suggestion.reason} warn={!suggestion.auto_apply}>
          <SuggestionActions
            inboxId={item.id}
            action="accept_disbursement"
            label={`Mark disbursement to ${suggestion.grantee_name} paid`}
            successMessage="Disbursement marked paid and linked"
            confirmMessage={`Mark the disbursement to ${suggestion.grantee_name} as paid? A matching "Grants paid" expense will be created, linked to this QuickBooks transaction.`}
          />
        </SuggestionCard>
      )}

      {suggestion?.type === 'pay_invoice' && (
        <SuggestionCard reason={suggestion.reason} warn={!suggestion.confident}>
          <InvoiceMatchForm item={item} candidates={suggestion.candidates} confident={suggestion.confident} />
        </SuggestionCard>
      )}

      {suggestion?.type === 'link_expense' && (
        <SuggestionCard reason={suggestion.reason}>
          <div className="flex items-center gap-3">
            <SuggestionActions
              inboxId={item.id}
              action="link_expense"
              label="Link to that expense"
              successMessage="Linked to the existing expense"
            />
            <Link
              href={`/expenses/${suggestion.expense_id}`}
              className="text-sm text-gray-500 hover:text-gray-900 underline"
            >
              View “{suggestion.expense_description}”
            </Link>
          </div>
        </SuggestionCard>
      )}

      {suggestion?.type === 'fund_pri' && (
        <SuggestionCard reason={suggestion.reason}>
          <PriFundingForm item={item} />
        </SuggestionCard>
      )}

      {suggestion?.type === 'new_contribution' && (
        <SuggestionCard reason={suggestion.reason}>
          <ContributionForm item={item} contacts={contacts} prefill={suggestion.prefill} />
        </SuggestionCard>
      )}

      {(suggestion?.type === 'new_expense' || suggestion === null) &&
        item.direction !== 'money_in' && (
          <ExpensePanel
            item={item}
            categories={categories}
            vendors={vendors}
            teamMembers={teamMembers}
            prefill={suggestion?.type === 'new_expense' ? suggestion.prefill : null}
            open
          />
        )}

      {/* Fallback for matched items: still allow creating a plain expense. */}
      {suggestion !== null &&
        suggestion.type !== 'new_expense' &&
        suggestion.type !== 'new_contribution' &&
        item.direction !== 'money_in' && (
          <ExpensePanel
            item={item}
            categories={categories}
            vendors={vendors}
            teamMembers={teamMembers}
            prefill={suggestion.type === 'pay_invoice' ? suggestion.prefill : null}
            summary={
              suggestion.type === 'pay_invoice'
                ? 'Not an invoice payment? Record it as a new expense'
                : undefined
            }
          />
        )}

      <DismissForm
        item={item}
        prefillReason={suggestion?.type === 'dismiss' ? suggestion.reason : null}
        prominent={suggestion?.type === 'dismiss'}
      />
    </div>
  )
}

function SuggestionCard({
  reason,
  warn = false,
  children,
}: {
  reason: string
  warn?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        warn ? 'border-yellow-200 bg-yellow-50' : 'border-blue-100 bg-blue-50'
      }`}
    >
      <p className={`text-sm mb-3 ${warn ? 'text-yellow-800' : 'text-blue-800'}`}>{reason}</p>
      {children}
    </div>
  )
}

function ExpensePanel({
  item,
  categories,
  vendors,
  teamMembers,
  prefill,
  open = false,
  summary = 'Record as expense',
}: {
  item: QboInboxItem
  categories: ExpenseCategory[]
  vendors: { id: string; display_name: string }[]
  teamMembers: { id: string; full_name: string }[]
  prefill: {
    expense_date: string | null
    amount_cents: number | null
    description: string | null
    category_id: string | null
    payment_method: string | null
    vendor_contact_id: string | null
  } | null
  open?: boolean
  summary?: string
}) {
  const expenseDefaults: Partial<Expense> = {
    expense_date: prefill?.expense_date ?? item.txn_date ?? undefined,
    amount_cents: prefill?.amount_cents ?? item.amount_cents ?? undefined,
    description: prefill?.description ?? item.qbo_private_note ?? item.counterparty_name ?? '',
    category_id: prefill?.category_id ?? undefined,
    payment_method: (prefill?.payment_method as ExpensePaymentMethod | null) ?? undefined,
    vendor_contact_id: prefill?.vendor_contact_id ?? undefined,
    status: 'paid',
  }

  return (
    <details open={open} className="rounded-lg border border-gray-200">
      <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer">
        {summary}
      </summary>
      <ActionForm action={approveAsExpense.bind(null, item.id)} className="px-4 pb-4 space-y-4">
        <ExpenseFormFields
          categories={categories}
          vendors={vendors}
          teamMembers={teamMembers}
          expense={expenseDefaults}
          idPrefix={`${item.id}_`}
        />
        <SubmitButton pendingLabel="Recording…">Record expense</SubmitButton>
      </ActionForm>
    </details>
  )
}

function InvoiceMatchForm({
  item,
  candidates,
  confident,
}: {
  item: QboInboxItem
  candidates: InvoiceMatch[]
  confident: boolean
}) {
  // Preselect only when the match is unambiguous; otherwise make the admin choose.
  const preselected = confident ? candidates[0]?.expense_id : undefined

  return (
    <ActionForm action={acceptInvoicePayment.bind(null, item.id)} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Invoice this payment settles</legend>
        {candidates.map((c) => (
          <label
            key={c.expense_id}
            className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3 cursor-pointer has-[:checked]:border-blue-400"
          >
            <input
              type="radio"
              name="expense_id"
              value={c.expense_id}
              required
              defaultChecked={c.expense_id === preselected}
              className="mt-1"
            />
            <span className="min-w-0 flex-1 text-sm">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-gray-900">{c.description}</span>
                {c.vendor_verified ? (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Vendor matches
                  </span>
                ) : (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Vendor not confirmed
                  </span>
                )}
              </span>
              <span className="block text-gray-500">
                {c.vendor_name ?? 'No vendor'} · invoiced {formatDate(c.expense_date)} ·{' '}
                {formatCents(item.amount_cents)}
                {' · '}
                <Link href={`/expenses/${c.expense_id}`} className="underline hover:text-gray-900">
                  View
                </Link>
              </span>
              {c.category_note && (
                <span className="block text-xs text-yellow-700 mt-1">{c.category_note}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <SubmitButton pendingLabel="Marking paid…">Mark invoice paid</SubmitButton>
      <p className="text-xs text-gray-500">
        The invoice becomes Paid and is linked to this QuickBooks transaction. If none of these
        is right, record the payment as a new expense or dismiss it below.
      </p>
    </ActionForm>
  )
}

function ContributionForm({
  item,
  contacts,
  prefill,
}: {
  item: QboInboxItem
  contacts: { id: string; display_name: string }[]
  prefill: {
    received_date: string | null
    amount_cents: number | null
    contact_id: string | null
    counterparty_name: string | null
  }
}) {
  return (
    <ActionForm action={approveAsContribution.bind(null, item.id)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`contact_id_${item.id}`} className={labelClass}>
            Donor
          </label>
          <ContactSelect
            id={`contact_id_${item.id}`}
            name="contact_id"
            contacts={contacts}
            defaultValue={prefill.contact_id}
            required
            placeholder="Select the donor…"
          />
          {!prefill.contact_id && (
            <p className="text-xs text-gray-400 mt-1">
              {prefill.counterparty_name
                ? `QuickBooks payer: “${prefill.counterparty_name}”. `
                : ''}
              Not in contacts yet?{' '}
              <Link href="/contacts/new" className="underline">
                Create the contact
              </Link>{' '}
              first, then sync this page.
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`amount_${item.id}`} className={labelClass}>
            Amount
          </label>
          <MoneyInput
            id={`amount_${item.id}`}
            name="amount"
            required
            defaultValue={
              prefill.amount_cents !== null ? centsToDollarString(prefill.amount_cents) : undefined
            }
          />
        </div>
        <div>
          <label htmlFor={`received_date_${item.id}`} className={labelClass}>
            Received date
          </label>
          <input
            id={`received_date_${item.id}`}
            type="date"
            name="received_date"
            required
            defaultValue={prefill.received_date ?? undefined}
            className="input"
          />
        </div>
        <div>
          <label htmlFor={`method_${item.id}`} className={labelClass}>
            Method
          </label>
          <select id={`method_${item.id}`} name="method" required defaultValue="" className="input">
            <option value="" disabled>
              How did it arrive?
            </option>
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="wire">Wire</option>
            <option value="credit_card">Credit card</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`notes_${item.id}`} className={labelClass}>
            Notes
          </label>
          <textarea id={`notes_${item.id}`} name="notes" rows={2} className="input" />
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Restriction defaults to unrestricted and vehicle to direct — edit the contribution
        afterwards for DAF gifts, restrictions, or quid pro quo details. Remember to generate the
        acknowledgement letter once recorded.
      </p>
      <SubmitButton pendingLabel="Recording…">Record contribution</SubmitButton>
    </ActionForm>
  )
}

function PriFundingForm({ item }: { item: QboInboxItem }) {
  return (
    <ActionForm action={acceptPriFunding.bind(null, item.id)} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`pri_method_${item.id}`} className={labelClass}>
          Method
        </label>
        <select
          id={`pri_method_${item.id}`}
          name="method"
          required
          defaultValue="wire"
          className="input"
        >
          <option value="check">Check</option>
          <option value="ach">ACH</option>
          <option value="wire">Wire</option>
        </select>
      </div>
      <div>
        <label htmlFor={`pri_date_${item.id}`} className={labelClass}>
          Funded date
        </label>
        <input
          id={`pri_date_${item.id}`}
          type="date"
          name="funded_date"
          defaultValue={item.txn_date ?? undefined}
          className="input"
        />
      </div>
      <SubmitButton pendingLabel="Funding…">Mark PRI funded</SubmitButton>
    </ActionForm>
  )
}

function DismissForm({
  item,
  prefillReason,
  prominent,
}: {
  item: QboInboxItem
  prefillReason: string | null
  prominent?: boolean
}) {
  const form = (
    <ActionForm action={dismissItem.bind(null, item.id)} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-64">
        <label htmlFor={`reason_${item.id}`} className={labelClass}>
          Reason
        </label>
        <input
          id={`reason_${item.id}`}
          type="text"
          name="reason"
          defaultValue={prefillReason ?? ''}
          placeholder="Why is no record needed here?"
          className="input"
        />
      </div>
      <SubmitButton className="btn btn-secondary" pendingLabel="Dismissing…">
        Dismiss
      </SubmitButton>
    </ActionForm>
  )

  if (prominent) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600 mb-3">{prefillReason}</p>
        {form}
      </div>
    )
  }

  return (
    <details className="rounded-lg border border-gray-200">
      <summary className="px-4 py-3 text-sm font-medium text-gray-500 cursor-pointer">
        Dismiss — no record needed here
      </summary>
      <div className="px-4 pb-4">{form}</div>
    </details>
  )
}

function ChangedPanel({ item }: { item: QboInboxItem }) {
  const beforeCents = rawAmountCents(item.previous_raw)
  const afterCents = rawAmountCents(item.raw)
  const beforeDate = rawField(item.previous_raw, 'TxnDate')
  const afterDate = rawField(item.raw, 'TxnDate')
  const linked = item.expense_id ?? item.contribution_id

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-3">
      <p className="text-sm text-yellow-800 font-medium">
        This transaction was edited in QuickBooks after it was recorded here.
      </p>
      <ul className="text-sm text-yellow-900 space-y-1">
        {beforeCents !== afterCents && (
          <li>
            Amount: {formatCents(beforeCents)} → <strong>{formatCents(afterCents)}</strong>
          </li>
        )}
        {typeof beforeDate === 'string' && typeof afterDate === 'string' && beforeDate !== afterDate && (
          <li>
            Date: {formatDate(beforeDate)} → <strong>{formatDate(afterDate)}</strong>
          </li>
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {linked && (
          <SuggestionActions
            inboxId={item.id}
            action="apply_change"
            label="Apply to the record here"
            successMessage="Record updated to match QuickBooks"
          />
        )}
        <SuggestionActions
          inboxId={item.id}
          action="acknowledge"
          label="Acknowledge, keep the record here as is"
          successMessage="Change acknowledged"
          secondary
        />
      </div>
      <LinkedRecordLinks item={item} />
    </div>
  )
}

function DeletedPanel({ item }: { item: QboInboxItem }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
      <p className="text-sm text-red-700 font-medium">
        This transaction was deleted in QuickBooks after it was recorded here. The linked
        record was not touched — delete or edit it manually if the books should change.
      </p>
      <div className="flex items-center gap-3">
        <SuggestionActions
          inboxId={item.id}
          action="acknowledge"
          label="Acknowledge"
          successMessage="Deletion acknowledged"
          secondary
        />
      </div>
      <LinkedRecordLinks item={item} />
    </div>
  )
}

function ResolvedPanel({ item }: { item: QboInboxItem }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
      {item.dismiss_reason && <span>Dismissed: {item.dismiss_reason}</span>}
      <LinkedRecordLinks item={item} />
      {item.status === 'dismissed' && (
        <SuggestionActions
          inboxId={item.id}
          action="reopen"
          label="Reopen"
          successMessage="Item reopened for review"
          secondary
        />
      )}
    </div>
  )
}

function LinkedRecordLinks({ item }: { item: QboInboxItem }) {
  const resolution = item.resolution as { grant_out_id?: string } | null
  const links: { href: string; label: string }[] = []
  if (item.expense_id) links.push({ href: `/expenses/${item.expense_id}`, label: 'View expense' })
  if (item.contribution_id)
    links.push({ href: `/contributions/${item.contribution_id}`, label: 'View contribution' })
  if (resolution?.grant_out_id)
    links.push({ href: `/grants-out/awards/${resolution.grant_out_id}`, label: 'View award' })
  if (item.pri_id) links.push({ href: `/pris/${item.pri_id}`, label: 'View PRI' })
  if (links.length === 0) return null
  return (
    <span className="flex items-center gap-3">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-sm text-gray-500 underline hover:text-gray-900">
          {l.label}
        </Link>
      ))}
    </span>
  )
}
