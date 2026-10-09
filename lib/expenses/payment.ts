import type { Expense } from '@/lib/supabase/types/database'

/**
 * An unpaid invoice waiting for its bank payment: pending, paid from org
 * funds (not a reimbursement to a team member), and never pushed to QuickBooks.
 *
 * These stay out of QBO until the payment arrives through the pull and a
 * admin matches it in /banking — otherwise QBO would show cash leaving the
 * bank on the invoice date.
 */
export function awaitsBankPayment(
  expense: Pick<Expense, 'status' | 'paid_by' | 'payment_method' | 'qbo_purchase_id'>
): boolean {
  return (
    expense.status === 'pending' &&
    !expense.paid_by &&
    expense.payment_method !== 'reimbursement' &&
    !expense.qbo_purchase_id
  )
}

/**
 * Whether "Send to QuickBooks" may create a QuickBooks transaction for this
 * expense. Never for one that is already there: sent before (purchase id),
 * or born from a pulled QuickBooks transaction (qbo_source 'qbo', e.g. a
 * journal entry or deposit approved in Banking, which has no purchase id), or
 * linked from a Banking inbox item. Sending those would book them twice.
 */
export function canSendToQuickBooks(
  expense: Pick<Expense, 'qbo_purchase_id' | 'qbo_source'>,
  linkedToInboxItem: boolean
): boolean {
  return !expense.qbo_purchase_id && expense.qbo_source !== 'qbo' && !linkedToInboxItem
}

/** How far around the invoice date a payment can land and still match. */
export const INVOICE_PAYMENT_WINDOW = { daysBefore: 7, daysAfter: 180 }
