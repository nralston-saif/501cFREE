import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'
import { ActionError } from '@/lib/actions/helpers'
import { orgToday } from '@/lib/settings'

/**
 * Mark a disbursement paid and auto-create the matching grants-paid expense
 * so 990 functional totals stay complete without double entry.
 *
 * Two callers:
 * - the "Mark paid" button (no qboPurchaseId): the created expense
 *   is app-owned and not in QBO. Its wire arrives through the bank feed and
 *   is linked in Banking, or (paid from an account with no feed) an admin
 *   uses "Send to QuickBooks" on the expense.
 * - the QBO pull sync, when the bank transaction for a scheduled disbursement
 *   arrives (qboPurchaseId set): the expense is born already linked to that
 *   QBO transaction (qbo_source='qbo', synced) and nothing is pushed back.
 *
 * Throws ActionError with user-facing text; callers outside the action layer
 * (the cron auto-apply) catch and record it.
 */
export async function applyDisbursementPaid(
  supabase: SupabaseClient<Database>,
  params: {
    disbursementId: string
    memberId: string | null
    paidDate?: string
    qboPurchaseId?: string
    /**
     * The payment already exists in QBO in some form (defaults to true when
     * qboPurchaseId is set). Suppresses the push even without a Purchase id —
     * e.g. when the QBO side is a JournalEntry.
     */
    fromQbo?: boolean
  }
): Promise<{ grantOutId: string; expenseId: string | null }> {
  const { data: disbursement, error: loadError } = await supabase
    .from('disbursements')
    .select('*')
    .eq('id', params.disbursementId)
    .single()

  if (loadError || !disbursement) throw new ActionError('Disbursement not found')
  if (disbursement.status === 'paid') throw new ActionError('Already marked paid')
  if (disbursement.status !== 'scheduled') {
    throw new ActionError('Only a scheduled disbursement can be marked paid')
  }

  const { data: award } = await supabase
    .from('grants_out')
    .select('id, purpose, grantee_contact_id, agreement_signed_date')
    .eq('id', disbursement.grant_out_id)
    .single()

  if (!award) throw new ActionError('Award not found')
  if (!award.agreement_signed_date) {
    throw new ActionError(
      'No signed grant agreement is recorded for this award. Record the agreement signed date on the award before paying disbursements.'
    )
  }

  const { data: granteeContact } = await supabase
    .from('contacts')
    .select('display_name')
    .eq('id', award.grantee_contact_id)
    .maybeSingle()

  const paidDate = params.paidDate ?? (await orgToday(supabase))

  // Conditional on still being scheduled: of two concurrent clicks (or a
  // click racing the QBO auto-apply) only one update matches a row, and only
  // that caller goes on to create the expense. A cancelled disbursement never
  // matches either.
  const { data: claimed, error: updateError } = await supabase
    .from('disbursements')
    .update({ status: 'paid', paid_date: paidDate })
    .eq('id', params.disbursementId)
    .eq('status', 'scheduled')
    .select('id')

  if (updateError) throw new ActionError(updateError.message)
  if (!claimed || claimed.length === 0) {
    throw new ActionError('This disbursement is no longer scheduled (already paid or cancelled). Refresh the page.')
  }

  // Found by its stable system key, so renaming the category is safe
  const { data: grantsPaidCategory } = await supabase
    .from('expense_categories')
    .select('id')
    .eq('system_key', 'grants_paid')
    .maybeSingle()

  let expenseId: string | null = null
  if (grantsPaidCategory) {
    const fromQbo = params.fromQbo ?? Boolean(params.qboPurchaseId)
    const { data: created, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        expense_date: paidDate,
        amount_cents: disbursement.amount_cents,
        description: `Grant disbursement - ${granteeContact?.display_name ?? 'grantee'}${award.purpose ? `: ${award.purpose}` : ''}`,
        category_id: grantsPaidCategory.id,
        vendor_contact_id: award.grantee_contact_id ?? null,
        payment_method: disbursement.method,
        status: 'paid',
        disbursement_id: params.disbursementId,
        entered_by: params.memberId,
        ...(fromQbo
          ? {
              qbo_purchase_id: params.qboPurchaseId ?? null,
              qbo_source: 'qbo' as const,
              qbo_sync_status: 'synced' as const,
              qbo_synced_at: new Date().toISOString(),
            }
          : {}),
      })
      .select('id')
      .single()

    if (expenseError || !created) {
      // Put the disbursement back so the payment can be retried; a paid
      // disbursement without its expense would leave the 990 totals short.
      await supabase
        .from('disbursements')
        .update({ status: 'scheduled', paid_date: null })
        .eq('id', params.disbursementId)
        .eq('status', 'paid')
      throw new ActionError(
        `Couldn't record the grants-paid expense, so the disbursement was left scheduled: ${expenseError?.message ?? 'no row returned'}`
      )
    }
    expenseId = created.id
  }

  return { grantOutId: disbursement.grant_out_id, expenseId }
}
