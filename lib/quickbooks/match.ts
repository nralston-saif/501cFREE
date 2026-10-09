import type { NormalizedTxn } from './normalize'
import { INVOICE_PAYMENT_WINDOW } from '@/lib/expenses/payment'

/**
 * Pure matching engine: given a normalized pulled transaction and a
 * pre-loaded context of open internal records, produce the suggestion shown
 * in the inbox (and, for exact disbursement matches, the auto-apply signal).
 *
 * Matching is deliberately conservative — exact amounts and exact
 * (normalized) names only. For a small team, a missed match costs one
 * click; a wrong auto-apply costs trust.
 */

export type DisbursementCandidate = {
  id: string
  grant_out_id: string
  amount_cents: number
  scheduled_date: string | null
  grantee_contact_id: string
  grantee_name: string
  grantee_qbo_vendor_id: string | null
  agreement_signed_date: string | null
}

export type ExpenseCandidate = {
  id: string
  amount_cents: number
  expense_date: string
  description: string
  vendor_contact_id: string | null
  vendor_name: string | null
  vendor_qbo_vendor_id: string | null
}

/** A pending invoice awaiting its bank payment (see awaitsBankPayment). */
export type OpenInvoiceCandidate = ExpenseCandidate & {
  category_id: string
}

export type PriCandidate = {
  id: string
  amount_cents: number
  recipient_contact_id: string
  recipient_name: string
  recipient_qbo_vendor_id: string | null
}

export type ContactCandidate = {
  id: string
  display_name: string
  qbo_vendor_id: string | null
}

export type MatchContext = {
  scheduledDisbursements: DisbursementCandidate[]
  unlinkedExpenses: ExpenseCandidate[]
  openInvoices: OpenInvoiceCandidate[]
  committedPris: PriCandidate[]
  contacts: ContactCandidate[]
  /** qbo expense-account id → app category id (qbo_mappings inverted) */
  categoryByQboAccount: Record<string, string>
  /** qbo bank/cc account id → app payment method (qbo_mappings inverted) */
  paymentMethodByQboAccount: Record<string, string>
  /** qbo account id → QBO AccountType ('Income', 'Expense', 'Bank', ...) */
  accountTypeById: Record<string, string>
}

export type ExpensePrefill = {
  expense_date: string | null
  amount_cents: number | null
  description: string | null
  category_id: string | null
  payment_method: string | null
  vendor_contact_id: string | null
}

export type ContributionPrefill = {
  received_date: string | null
  amount_cents: number | null
  contact_id: string | null
  counterparty_name: string | null
}

export type InvoiceMatch = {
  expense_id: string
  description: string
  expense_date: string
  vendor_name: string | null
  /** The QBO payee is this invoice's vendor (by QBO vendor id or name). */
  vendor_verified: boolean
  /** Set when QBO categorized the payment differently from the invoice. */
  category_note: string | null
}

export type Suggestion =
  | {
      type: 'disbursement_paid'
      disbursement_id: string
      grant_out_id: string
      grantee_name: string
      auto_apply: boolean
      reason: string
    }
  | { type: 'link_expense'; expense_id: string; expense_description: string; reason: string }
  | {
      type: 'pay_invoice'
      /** Best first. One verified candidate → confident; anything else needs a look. */
      candidates: InvoiceMatch[]
      confident: boolean
      reason: string
      /** For "not this invoice": record the payment as its own expense. */
      prefill: ExpensePrefill
    }
  | { type: 'fund_pri'; pri_id: string; recipient_name: string; reason: string }
  | { type: 'new_expense'; prefill: ExpensePrefill; reason: string }
  | { type: 'new_contribution'; prefill: ContributionPrefill; reason: string }
  | { type: 'dismiss'; reason: string }

const NAME_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'co',
  'corp',
  'corporation',
  'company',
  'foundation',
  'fdn',
  'the',
])

/** Lowercase, strip punctuation and org suffixes; exact equality after that. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '' && !NAME_SUFFIXES.has(token))
    .join(' ')
}

function namesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const na = normalizeName(a)
  return na !== '' && na === normalizeName(b)
}

function counterpartyMatches(
  txn: NormalizedTxn,
  target: { name: string | null; qboVendorId: string | null }
): boolean {
  if (txn.entity_ref_id && target.qboVendorId && txn.entity_ref_id === target.qboVendorId) {
    return true
  }
  return namesMatch(txn.counterparty_name, target.name)
}

function dayDiff(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000
}

export function matchTransaction(txn: NormalizedTxn, ctx: MatchContext): Suggestion | null {
  if (txn.qbo_entity_type === 'Transfer') {
    return { type: 'dismiss', reason: 'Internal transfer between accounts — no record needed here.' }
  }
  if (txn.direction === 'money_out') return matchMoneyOut(txn, ctx)
  if (txn.direction === 'money_in') return matchMoneyIn(txn, ctx)
  return null
}

function matchMoneyOut(txn: NormalizedTxn, ctx: MatchContext): Suggestion {
  // 1. Scheduled grant disbursement with the exact amount.
  if (txn.amount_cents !== null) {
    const byAmount = ctx.scheduledDisbursements.filter(
      (d) => d.amount_cents === txn.amount_cents
    )
    if (byAmount.length > 0) {
      const verified = byAmount.filter((d) =>
        counterpartyMatches(txn, { name: d.grantee_name, qboVendorId: d.grantee_qbo_vendor_id })
      )
      const pool = verified.length > 0 ? verified : byAmount
      // Nearest scheduled date when several match.
      const best = [...pool].sort((a, b) => {
        if (!txn.txn_date) return 0
        const da = a.scheduled_date ? dayDiff(a.scheduled_date, txn.txn_date) : Infinity
        const db = b.scheduled_date ? dayDiff(b.scheduled_date, txn.txn_date) : Infinity
        return da - db
      })[0]

      const payeeVerified = verified.length > 0
      const unambiguous = verified.length === 1
      const agreementSigned = best.agreement_signed_date !== null
      const autoApply = payeeVerified && unambiguous && agreementSigned
      const reason = autoApply
        ? `Exact match: scheduled disbursement of the same amount to ${best.grantee_name}.`
        : !payeeVerified
          ? `Amount matches a scheduled disbursement to ${best.grantee_name}, but the payee could not be verified.`
          : !unambiguous
            ? 'Amount matches more than one scheduled disbursement — picked the nearest by date.'
            : `Matches the scheduled disbursement to ${best.grantee_name}, but the award has no signed agreement recorded.`
      return {
        type: 'disbursement_paid',
        disbursement_id: best.id,
        grant_out_id: best.grant_out_id,
        grantee_name: best.grantee_name,
        auto_apply: autoApply,
        reason,
      }
    }
  }

  // 2. Payment of a pending invoice. Never auto — an admin confirms which
  //    invoice this pays (or that it pays none of them).
  const invoice = matchOpenInvoice(txn, ctx)
  if (invoice) return invoice

  // 3. Existing expense entered manually before the bank transaction cleared.
  if (txn.amount_cents !== null && txn.txn_date) {
    const candidates = ctx.unlinkedExpenses.filter((e) => {
      if (e.amount_cents !== txn.amount_cents) return false
      if (dayDiff(e.expense_date, txn.txn_date as string) > 3) return false
      const bothVendorless = !e.vendor_contact_id && !txn.counterparty_name && !txn.entity_ref_id
      return (
        bothVendorless ||
        counterpartyMatches(txn, { name: e.vendor_name, qboVendorId: e.vendor_qbo_vendor_id })
      )
    })
    if (candidates.length > 0) {
      const best = [...candidates].sort(
        (a, b) => dayDiff(a.expense_date, txn.txn_date as string) - dayDiff(b.expense_date, txn.txn_date as string)
      )[0]
      return {
        type: 'link_expense',
        expense_id: best.id,
        expense_description: best.description,
        reason: 'Same amount, date, and payee as an expense already recorded here — link instead of duplicating.',
      }
    }
  }

  // 4. Committed PRI (wire out to the recipient). Never auto — funding gates
  //    (memo, executed instrument, board approval) live in markPriFunded.
  if (txn.amount_cents !== null) {
    const pri = ctx.committedPris.find(
      (p) =>
        p.amount_cents === txn.amount_cents &&
        counterpartyMatches(txn, { name: p.recipient_name, qboVendorId: p.recipient_qbo_vendor_id })
    )
    if (pri) {
      return {
        type: 'fund_pri',
        pri_id: pri.id,
        recipient_name: pri.recipient_name,
        reason: `Matches the committed PRI to ${pri.recipient_name}. Funding runs through the PRI's own gates.`,
      }
    }
  }

  // 5. Fallback: a fresh expense, prefilled as far as the mappings allow.
  return {
    type: 'new_expense',
    prefill: newExpensePrefill(txn, ctx),
    reason: 'New transaction from QuickBooks with no matching record here.',
  }
}

function qboCategoryId(txn: NormalizedTxn, ctx: MatchContext): string | null {
  return (
    txn.qbo_line_account_ids
      .map((id) => ctx.categoryByQboAccount[id])
      .find((id) => id !== undefined) ?? null
  )
}

function newExpensePrefill(txn: NormalizedTxn, ctx: MatchContext): ExpensePrefill {
  return {
    expense_date: txn.txn_date,
    amount_cents: txn.amount_cents,
    description: txn.qbo_private_note ?? txn.counterparty_name ?? null,
    category_id: qboCategoryId(txn, ctx),
    payment_method: paymentMethodFor(txn, ctx),
    vendor_contact_id: findContact(txn, ctx)?.id ?? null,
  }
}

/** Signed days from the invoice date to the payment date (negative = paid before). */
function daysAfter(invoiceDate: string, paymentDate: string): number {
  return (
    (new Date(`${paymentDate}T00:00:00Z`).getTime() -
      new Date(`${invoiceDate}T00:00:00Z`).getTime()) /
    86_400_000
  )
}

function matchOpenInvoice(txn: NormalizedTxn, ctx: MatchContext): Suggestion | null {
  if (txn.amount_cents === null || !txn.txn_date) return null
  const paidOn = txn.txn_date

  const inWindow = ctx.openInvoices.filter((e) => {
    if (e.amount_cents !== txn.amount_cents) return false
    const offset = daysAfter(e.expense_date, paidOn)
    return offset >= -INVOICE_PAYMENT_WINDOW.daysBefore && offset <= INVOICE_PAYMENT_WINDOW.daysAfter
  })
  if (inWindow.length === 0) return null

  const qboCategory = qboCategoryId(txn, ctx)
  const ranked = inWindow
    .map((e) => ({
      invoice: e,
      verified: counterpartyMatches(txn, { name: e.vendor_name, qboVendorId: e.vendor_qbo_vendor_id }),
    }))
    // Verified payee first, then the invoice dated closest before the payment.
    .sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1
      return dayDiff(a.invoice.expense_date, paidOn) - dayDiff(b.invoice.expense_date, paidOn)
    })

  const candidates: InvoiceMatch[] = ranked.map(({ invoice, verified }) => ({
    expense_id: invoice.id,
    description: invoice.description,
    expense_date: invoice.expense_date,
    vendor_name: invoice.vendor_name,
    vendor_verified: verified,
    category_note:
      qboCategory && qboCategory !== invoice.category_id
        ? 'QuickBooks filed this payment under a different category than the invoice. The invoice keeps its category here; fix QuickBooks if it is wrong.'
        : null,
  }))

  const verifiedCount = candidates.filter((c) => c.vendor_verified).length
  const confident = verifiedCount === 1
  const best = candidates[0]
  const payee = txn.counterparty_name ? `“${txn.counterparty_name}”` : 'an unnamed payee'
  const reason = confident
    ? `Pays the open invoice “${best.description}”: same amount and vendor.`
    : verifiedCount > 1
      ? `Same amount and vendor as ${verifiedCount} open invoices. Pick the one this pays.`
      : candidates.length > 1
        ? `Same amount as ${candidates.length} open invoices, but QuickBooks shows ${payee} as the payee, which matches none of their vendors. Pick one only if you're sure, or record this as a new expense.`
        : `Same amount as the open invoice “${best.description}”, but QuickBooks shows ${payee} as the payee, not ${best.vendor_name ?? 'a vendor on the invoice'}. Confirm only if this is the payment.`

  return {
    type: 'pay_invoice',
    candidates,
    confident,
    reason,
    prefill: newExpensePrefill(txn, ctx),
  }
}

function matchMoneyIn(txn: NormalizedTxn, ctx: MatchContext): Suggestion {
  const accountTypes = txn.qbo_line_account_ids.map((id) => ctx.accountTypeById[id] ?? 'Unknown')

  // Refund from a vendor (Purchase Credit or deposit crediting an expense account).
  if (
    txn.qbo_entity_type === 'Purchase' ||
    accountTypes.some((t) => t === 'Expense' || t === 'Other Expense' || t === 'Cost of Goods Sold')
  ) {
    return {
      type: 'dismiss',
      reason:
        'Vendor refund/credit — the books are correct in QuickBooks. (expenses here cannot go negative yet.)',
    }
  }

  const hitsIncome = accountTypes.some((t) => t === 'Income' || t === 'Other Income')
  if (txn.qbo_entity_type === 'Deposit' && hitsIncome) {
    const donor = findContact(txn, ctx)
    return {
      type: 'new_contribution',
      prefill: {
        received_date: txn.txn_date,
        amount_cents: txn.amount_cents,
        contact_id: donor?.id ?? null,
        counterparty_name: txn.counterparty_name,
      },
      reason: donor
        ? `Deposit to an income account from ${donor.display_name} — looks like a contribution.`
        : 'Deposit to an income account — looks like a contribution; pick or create the donor.',
    }
  }

  return {
    type: 'dismiss',
    reason: 'Non-donation income (interest, etc.) — tracked in QuickBooks.',
  }
}

function findContact(txn: NormalizedTxn, ctx: MatchContext): ContactCandidate | null {
  if (txn.entity_ref_id) {
    const byVendorId = ctx.contacts.find((c) => c.qbo_vendor_id === txn.entity_ref_id)
    if (byVendorId) return byVendorId
  }
  if (txn.counterparty_name) {
    const byName = ctx.contacts.find((c) => namesMatch(txn.counterparty_name, c.display_name))
    if (byName) return byName
  }
  return null
}

function paymentMethodFor(txn: NormalizedTxn, ctx: MatchContext): string | null {
  // Purchase.PaymentType is authoritative for card/check; 'Cash' is what our
  // own push writes for ach/wire, so fall through to the account mapping.
  if (txn.payment_type === 'CreditCard') return 'card'
  if (txn.payment_type === 'Check') return 'check'
  if (txn.qbo_payment_account_id) {
    return ctx.paymentMethodByQboAccount[txn.qbo_payment_account_id] ?? null
  }
  return null
}
