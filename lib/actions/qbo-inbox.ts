'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminId, requiredString, optionalString, ActionError, runAction, type ActionResult } from './helpers'
import { parseDollarsToCents } from '@/lib/utils/money'
import { runQboPull, type PullStats } from '@/lib/quickbooks/pull'
import { syncExpenseToQbo } from '@/lib/quickbooks/sync'
import { applyDisbursementPaid } from '@/lib/grants/disburse'
import { markPriFunded } from './pris'
import { unwrapAction } from './result'
import { awaitsBankPayment } from '@/lib/expenses/payment'
import type { Suggestion } from '@/lib/quickbooks/match'
import type {
  ContributionMethod,
  ContributionVehicle,
  ExpensePaymentMethod,
  ExpenseStatus,
  Json,
  QboInboxItem,
  Restriction,
} from '@/lib/supabase/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'

/**
 * Review actions for the /banking inbox. Everything here resolves a pulled
 * QBO transaction into (or against) a record in the app. None of these create
 * anything in QuickBooks — the transaction already lives there. Once linked,
 * fillInQbo copies the app's payee/category/class/description/receipts onto it.
 */

/** After the response: fill in the linked QBO transaction from the expense. */
function fillInQbo(supabase: SupabaseClient<Database>, expenseId: string | null | undefined) {
  if (expenseId) after(() => syncExpenseToQbo(supabase, expenseId))
}

function suggestionOf(item: QboInboxItem): Suggestion | null {
  return (item.suggestion as unknown as Suggestion) ?? null
}

async function loadPendingItem(
  supabase: SupabaseClient<Database>,
  inboxId: string
): Promise<QboInboxItem> {
  const { data: item } = await supabase
    .from('qbo_inbox')
    .select('*')
    .eq('id', inboxId)
    .maybeSingle()
  if (!item) throw new ActionError('Inbox item not found')
  if (item.status !== 'pending') throw new ActionError('This item has already been reviewed')
  return item
}

function reviewStamp(memberId: string) {
  return { reviewed_by: memberId, reviewed_at: new Date().toISOString() }
}

function revalidateBanking() {
  revalidatePath('/banking')
  revalidatePath('/')
}

/** Manual "Sync now" — same pull the cron runs, as the signed-in admin. */
export async function syncNow(): Promise<ActionResult<PullStats>> {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()
    const stats = await runQboPull(supabase)
    revalidateBanking()
    return stats
  })
}

/** Accept a disbursement match: mark it paid, linked to the QBO transaction. */
export async function acceptDisbursementMatch(inboxId: string) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)

    const suggestion = suggestionOf(item)
    if (suggestion?.type !== 'disbursement_paid') {
      throw new ActionError('No disbursement match on this item')
    }

    const { grantOutId, expenseId } = await applyDisbursementPaid(supabase, {
      disbursementId: suggestion.disbursement_id,
      memberId,
      paidDate: item.txn_date ?? undefined,
      qboPurchaseId: item.qbo_entity_type === 'Purchase' ? item.qbo_entity_id : undefined,
      fromQbo: true,
    })

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        disbursement_id: suggestion.disbursement_id,
        expense_id: expenseId,
        resolution: { action: 'disbursement_paid', grant_out_id: grantOutId } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    fillInQbo(supabase, expenseId)
    revalidateBanking()
    revalidatePath(`/grants-out/awards/${grantOutId}`)
    revalidatePath('/expenses')
  })
}

/** Link the QBO transaction to an expense that already exists in the app. */
export async function acceptExpenseLink(inboxId: string) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)

    const suggestion = suggestionOf(item)
    if (suggestion?.type !== 'link_expense') {
      throw new ActionError('No expense link on this item')
    }

    const { error } = await supabase
      .from('expenses')
      .update({
        // From here on, QBO owns this transaction: no more pushes for this row.
        qbo_source: 'qbo',
        qbo_sync_status: 'synced',
        qbo_synced_at: new Date().toISOString(),
        qbo_sync_error: null,
        ...(item.qbo_entity_type === 'Purchase' ? { qbo_purchase_id: item.qbo_entity_id } : {}),
      })
      .eq('id', suggestion.expense_id)
    if (error) throw new ActionError(error.message)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        expense_id: suggestion.expense_id,
        resolution: { action: 'link_expense' } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    fillInQbo(supabase, suggestion.expense_id)
    revalidateBanking()
    revalidatePath('/expenses')
    revalidatePath(`/expenses/${suggestion.expense_id}`)
  })
}

/**
 * Mark a pending invoice paid by this QBO transaction. The admin picks the
 * invoice (`expense_id`) from the suggestion's candidates. The expense keeps
 * its invoice date and category; QBO now owns the transaction, so nothing is
 * pushed back.
 */
export async function acceptInvoicePayment(inboxId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)

    const suggestion = suggestionOf(item)
    if (suggestion?.type !== 'pay_invoice') {
      throw new ActionError('No invoice match on this item')
    }
    const expenseId = requiredString(formData, 'expense_id')
    if (!suggestion.candidates.some((c) => c.expense_id === expenseId)) {
      throw new ActionError('That invoice is not one of the matches for this payment')
    }

    const { data: expense } = await supabase
      .from('expenses')
      .select('id, amount_cents, status, paid_by, payment_method, qbo_purchase_id')
      .eq('id', expenseId)
      .maybeSingle()
    if (!expense) throw new ActionError('That invoice no longer exists')
    if (!awaitsBankPayment(expense)) {
      throw new ActionError(
        'That invoice is no longer waiting for payment (already paid or linked). Sync to refresh the matches.'
      )
    }
    if (expense.amount_cents !== item.amount_cents) {
      throw new ActionError('The invoice amount changed since this match was made. Sync to refresh.')
    }

    const { data: mappings } = await supabase
      .from('qbo_mappings')
      .select('qbo_id, local_key')
      .eq('mapping_type', 'payment_method')
    const paymentMethod =
      expense.payment_method ??
      (mappings ?? []).find(
        (m) => m.qbo_id === item.qbo_payment_account_id && m.local_key !== '_default'
      )?.local_key ??
      null

    const { error } = await supabase
      .from('expenses')
      .update({
        status: 'paid',
        payment_method: paymentMethod as ExpensePaymentMethod | null,
        // From here on, QBO owns this transaction: no more pushes for this row.
        qbo_source: 'qbo',
        qbo_sync_status: 'synced',
        qbo_synced_at: new Date().toISOString(),
        qbo_sync_error: null,
        ...(item.qbo_entity_type === 'Purchase' ? { qbo_purchase_id: item.qbo_entity_id } : {}),
      })
      .eq('id', expenseId)
    if (error) throw new ActionError(error.message)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        expense_id: expenseId,
        resolution: { action: 'pay_invoice', paid_date: item.txn_date } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    fillInQbo(supabase, expenseId)
    revalidateBanking()
    revalidatePath('/expenses')
    revalidatePath(`/expenses/${expenseId}`)
  })
}

/** Create a new expense from the (reviewed, possibly edited) prefilled form. */
export async function approveAsExpense(inboxId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)

    const amountCents = parseDollarsToCents(requiredString(formData, 'amount'))
    if (amountCents === null) throw new ActionError('Invalid amount')

    const { data: created, error } = await supabase
      .from('expenses')
      .insert({
        expense_date: requiredString(formData, 'expense_date'),
        amount_cents: amountCents,
        description: requiredString(formData, 'description'),
        category_id: requiredString(formData, 'category_id'),
        vendor_contact_id: optionalString(formData, 'vendor_contact_id'),
        payment_method: optionalString(formData, 'payment_method') as ExpensePaymentMethod | null,
        status: (optionalString(formData, 'status') ?? 'paid') as ExpenseStatus,
        paid_by: optionalString(formData, 'paid_by'),
        is_1099_eligible: formData.get('is_1099_eligible') === 'on',
        notes: optionalString(formData, 'notes'),
        entered_by: memberId,
        // Born from QBO: already synced, never pushed back.
        qbo_source: 'qbo',
        qbo_sync_status: 'synced',
        qbo_synced_at: new Date().toISOString(),
        ...(item.qbo_entity_type === 'Purchase' ? { qbo_purchase_id: item.qbo_entity_id } : {}),
      })
      .select('id')
      .single()
    if (error) throw new ActionError(error.message)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        expense_id: created.id,
        resolution: { action: 'new_expense' } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    if (item.qbo_entity_type === 'Purchase') fillInQbo(supabase, created.id)
    revalidateBanking()
    revalidatePath('/expenses')
  })
}

/** Create a contribution from a deposit (slim field set; details editable later). */
export async function approveAsContribution(inboxId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)

    const amountCents = parseDollarsToCents(requiredString(formData, 'amount'))
    if (amountCents === null) throw new ActionError('Invalid amount')

    const method = requiredString(formData, 'method') as ContributionMethod
    if (!['check', 'ach', 'wire', 'credit_card'].includes(method)) {
      throw new ActionError('Invalid method')
    }

    const { data: created, error } = await supabase
      .from('contributions')
      .insert({
        contact_id: requiredString(formData, 'contact_id'),
        amount_cents: amountCents,
        received_date: requiredString(formData, 'received_date'),
        method,
        vehicle: (optionalString(formData, 'vehicle') ?? 'direct') as ContributionVehicle,
        restriction: (optionalString(formData, 'restriction') ?? 'unrestricted') as Restriction,
        notes: optionalString(formData, 'notes'),
        entered_by: memberId,
        qbo_txn_type: item.qbo_entity_type,
        qbo_txn_id: item.qbo_entity_id,
      })
      .select('id')
      .single()
    if (error) throw new ActionError(error.message)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        contribution_id: created.id,
        resolution: { action: 'new_contribution' } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    revalidateBanking()
    revalidatePath('/contributions')
  })
}

/**
 * Fund the matched PRI off this wire. Delegates to markPriFunded so every
 * funding gate (memo, executed instrument, board approval) still applies —
 * its errors surface verbatim.
 */
export async function acceptPriFunding(inboxId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)

    const suggestion = suggestionOf(item)
    if (suggestion?.type !== 'fund_pri') throw new ActionError('No PRI match on this item')

    unwrapAction(await markPriFunded(suggestion.pri_id, formData))

    await supabase
      .from('pris')
      .update({ qbo_txn_id: item.qbo_entity_id })
      .eq('id', suggestion.pri_id)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        pri_id: suggestion.pri_id,
        resolution: { action: 'fund_pri' } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    revalidateBanking()
    revalidatePath(`/pris/${suggestion.pri_id}`)
  })
}

export async function dismissItem(inboxId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    await loadPendingItem(supabase, inboxId)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'dismissed',
        dismiss_reason: optionalString(formData, 'reason'),
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    revalidateBanking()
  })
}

/** Acknowledge a QBO-side change/delete without touching the linked record. */
export async function acknowledgeItem(inboxId: string) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    await loadPendingItem(supabase, inboxId)

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        resolution: { action: 'acknowledged' } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    revalidateBanking()
  })
}

/**
 * For a 'changed' item: copy the QBO transaction's current amount/date onto
 * the linked record. Local only — nothing is pushed back.
 */
export async function applyQboChange(inboxId: string) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()
    const item = await loadPendingItem(supabase, inboxId)
    if (item.kind !== 'changed') throw new ActionError('This item has no QBO-side change to apply')

    let applied: Record<string, unknown> = {}
    if (item.expense_id) {
      const fields: { amount_cents?: number; expense_date?: string } = {}
      applied = fields
      if (item.amount_cents !== null) fields.amount_cents = item.amount_cents
      if (item.txn_date) fields.expense_date = item.txn_date
      if (Object.keys(applied).length > 0) {
        const { error } = await supabase
          .from('expenses')
          .update(fields)
          .eq('id', item.expense_id)
        if (error) throw new ActionError(error.message)
        revalidatePath(`/expenses/${item.expense_id}`)
        revalidatePath('/expenses')
      }
    } else if (item.contribution_id) {
      // Same lock as updateContribution: a sent letter freezes the contribution.
      const { data: letter } = await supabase
        .from('acknowledgement_letters')
        .select('status')
        .eq('contribution_id', item.contribution_id)
        .maybeSingle()
      if (letter?.status === 'sent') {
        throw new ActionError(
          'This contribution has a sent acknowledgement letter and can no longer be edited. Acknowledge the change instead.'
        )
      }
      const fields: { amount_cents?: number; received_date?: string } = {}
      applied = fields
      if (item.amount_cents !== null) fields.amount_cents = item.amount_cents
      if (item.txn_date) fields.received_date = item.txn_date
      if (Object.keys(applied).length > 0) {
        const { error } = await supabase
          .from('contributions')
          .update(fields)
          .eq('id', item.contribution_id)
        if (error) throw new ActionError(error.message)
        revalidatePath('/contributions')
      }
    } else {
      throw new ActionError('This item is not linked to a record — nothing to update')
    }

    await supabase
      .from('qbo_inbox')
      .update({
        status: 'approved',
        resolution: { action: 'applied_qbo_change', fields: applied } as Json,
        ...reviewStamp(memberId),
      })
      .eq('id', inboxId)

    revalidateBanking()
  })
}

/** Reopen a dismissed item for review. */
export async function reopenItem(inboxId: string) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const { data: item } = await supabase
      .from('qbo_inbox')
      .select('id, status')
      .eq('id', inboxId)
      .maybeSingle()
    if (!item) throw new ActionError('Inbox item not found')
    if (item.status !== 'dismissed') throw new ActionError('Only dismissed items can be reopened')

    await supabase
      .from('qbo_inbox')
      .update({ status: 'pending', dismiss_reason: null, reviewed_by: null, reviewed_at: null })
      .eq('id', inboxId)

    revalidateBanking()
  })
}
