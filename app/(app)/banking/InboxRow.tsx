import StatusBadge from '@/components/StatusBadge'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import InboxItemDetail, { type DetailProps } from './InboxItemDetail'
import type { Suggestion } from '@/lib/quickbooks/match'
import type { QboInboxItem } from '@/lib/supabase/types/database'

const ENTITY_LABELS: Record<string, string> = {
  Purchase: 'Purchase',
  Deposit: 'Deposit',
  Transfer: 'Transfer',
  JournalEntry: 'Journal entry',
  Bill: 'Bill',
  BillPayment: 'Bill payment',
  SalesReceipt: 'Sales receipt',
}

function suggestionChip(item: QboInboxItem): string | null {
  if (item.kind === 'deleted') return 'Deleted in QuickBooks'
  if (item.kind === 'changed') return 'Changed in QuickBooks'
  const suggestion = item.suggestion as unknown as Suggestion | null
  if (!suggestion) return null
  switch (suggestion.type) {
    case 'disbursement_paid':
      return `Matches disbursement to ${suggestion.grantee_name}`
    case 'pay_invoice':
      return suggestion.confident ? 'Pays an open invoice' : 'Possible invoice payment'
    case 'link_expense':
      return 'Matches an existing expense'
    case 'fund_pri':
      return `Matches committed PRI to ${suggestion.recipient_name}`
    case 'new_contribution':
      return 'Looks like a contribution'
    case 'new_expense':
      return 'New expense'
    case 'dismiss':
      return 'Suggest dismiss'
    default:
      return null
  }
}

export default function InboxRow(props: DetailProps) {
  const { item } = props
  const chip = item.status === 'pending' ? suggestionChip(item) : null

  return (
    <details className="card group">
      <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="text-gray-400 text-xs w-4 group-open:rotate-90 transition-transform">
          &#9656;
        </span>
        <span className="text-gray-500 text-sm whitespace-nowrap w-24">
          {formatDate(item.txn_date)}
        </span>
        <span className="flex-1 min-w-40 text-sm font-medium text-gray-900 truncate">
          {item.counterparty_name ?? item.qbo_private_note ?? ENTITY_LABELS[item.qbo_entity_type]}
        </span>
        <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">
          {ENTITY_LABELS[item.qbo_entity_type]}
        </span>
        {chip && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 whitespace-nowrap">
            {chip}
          </span>
        )}
        <StatusBadge status={item.status === 'echo' ? 'synced from app' : item.status} />
        <span
          className={`text-sm tabular-nums whitespace-nowrap w-28 text-right ${
            item.direction === 'money_in' ? 'text-green-700 font-medium' : 'text-gray-900'
          }`}
        >
          {item.direction === 'money_in' ? '+' : ''}
          {formatCents(item.amount_cents)}
        </span>
      </summary>
      <div className="border-t border-gray-100 px-4 py-4">
        <InboxItemDetail {...props} />
      </div>
    </details>
  )
}
