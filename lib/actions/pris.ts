'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireMemberId, requiredString, optionalString, ActionError, runAction } from './helpers'
import { formatCents, parseDollarsToCents } from '@/lib/utils/money'
import type { PriInstrument, PriMemo, PriStatus } from '@/lib/supabase/types/database'
import { PRI_MEMO_FIELDS, isPriMemoComplete } from '@/lib/pris/memo'
import { requiresBoardApproval } from '@/lib/pris/policy'
import { getOrgSettings, orgToday } from '@/lib/settings'
import { generatePriMemorandum } from './memoranda'

// PRIs are balance-sheet assets, not grants: nothing here may create a
// expenses row or otherwise feed the functional-expense / Schedule I /
// QuickBooks expense pipeline.

const PRI_INSTRUMENTS: readonly PriInstrument[] = [
  'safe',
  'convertible_note',
  'equity',
  'loan',
  'other',
]

export async function createPri(formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const amountInput = requiredString(formData, 'amount')
    const amountCents = parseDollarsToCents(amountInput)
    if (amountCents === null) throw new ActionError('Invalid amount')

    const instrument = requiredString(formData, 'instrument') as PriInstrument
    if (!PRI_INSTRUMENTS.includes(instrument)) throw new ActionError('Invalid instrument')

    const { data, error } = await supabase
      .from('pris')
      .insert({
        recipient_contact_id: requiredString(formData, 'recipient_contact_id'),
        instrument,
        purpose: optionalString(formData, 'purpose'),
        amount_cents: amountCents,
        investment_date: optionalString(formData, 'investment_date'),
        board_approval_date: optionalString(formData, 'board_approval_date'),
        notes: optionalString(formData, 'notes'),
        status: 'committed' as PriStatus,
      })
      .select('id')
      .single()

    if (error) throw new ActionError(error.message)

    revalidatePath('/pris')
    redirect(`/pris/${data.id}`)
  })
}

export async function setPriInvestmentDate(priId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('pris')
      .update({ investment_date: optionalString(formData, 'investment_date') })
      .eq('id', priId)

    if (error) throw new ActionError(error.message)
    revalidatePath(`/pris/${priId}`)
  })
}

export async function setPriBoardApprovalDate(priId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('pris')
      .update({ board_approval_date: optionalString(formData, 'board_approval_date') })
      .eq('id', priId)

    if (error) throw new ActionError(error.message)
    revalidatePath(`/pris/${priId}`)
  })
}

// --- Mission-alignment memo (one per PRI, gates funding) ---

function memoFields(formData: FormData): Partial<PriMemo> {
  const out: Partial<PriMemo> = {}
  for (const [key] of PRI_MEMO_FIELDS) {
    out[key] = optionalString(formData, key)
  }
  return out
}

export async function startPriMemo(priId: string) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('pri_memos')
      .select('id')
      .eq('pri_id', priId)
      .maybeSingle()

    if (existing) {
      revalidatePath(`/pris/${priId}`)
      return
    }

    const { error } = await supabase.from('pri_memos').insert({
      pri_id: priId,
      started_by: memberId,
      last_edited_by: memberId,
    })

    if (error) throw new ActionError(error.message)
    revalidatePath(`/pris/${priId}`)
  })
}

/**
 * Save the memo. Autosaves pass `revalidate: false` — revalidating the PRI
 * page on every debounced save would force a full server re-render of the
 * route the user is typing on; the editor holds the canonical state until
 * Done, which calls revalidatePri once.
 */
export async function updatePriMemo(
  priId: string,
  formData: FormData,
  opts: { revalidate?: boolean } = {}
) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('pri_memos')
      .select('id')
      .eq('pri_id', priId)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('pri_memos')
        .update({ ...memoFields(formData), last_edited_by: memberId })
        .eq('pri_id', priId)
      if (error) throw new ActionError(error.message)
    } else {
      const { error } = await supabase.from('pri_memos').insert({
        pri_id: priId,
        ...memoFields(formData),
        started_by: memberId,
        last_edited_by: memberId,
      })
      if (error) throw new ActionError(error.message)
    }

    if (opts.revalidate !== false) revalidatePath(`/pris/${priId}`)
  })
}

/** Refresh the PRI page once after an autosave editing session ends. */
export async function revalidatePri(priId: string) {
  return runAction(async () => {
    await requireMemberId()
    revalidatePath(`/pris/${priId}`)
  })
}

// --- Funding ---

/**
 * Mark a PRI funded. Gated on the compliance file being complete: the
 * mission-alignment memo fully answered, the signed instrument attached, and
 * — for investments at/above the policy threshold — a board approval date.
 * Deliberately does NOT create an expense — the wire is a balance-sheet
 * transfer recorded in QuickBooks manually.
 */
export async function markPriFunded(priId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data: pri, error: loadError } = await supabase
      .from('pris')
      .select('*')
      .eq('id', priId)
      .single()

    if (loadError || !pri) throw new ActionError('PRI not found')
    if (pri.status !== 'committed') throw new ActionError('This PRI is already funded')

    const { pri_board_approval_threshold_cents: threshold } = await getOrgSettings(supabase)
    if (requiresBoardApproval(pri.amount_cents, threshold) && !pri.board_approval_date) {
      throw new ActionError(
        `Board approval is required for investments of ${formatCents(threshold)} or more — record the approval date before funding.`
      )
    }

    const { data: memo } = await supabase
      .from('pri_memos')
      .select('*')
      .eq('pri_id', priId)
      .maybeSingle()

    if (!isPriMemoComplete(memo)) {
      throw new ActionError(
        'The mission-alignment memo must be fully answered before funding this PRI.'
      )
    }

    // The generated memo PDF is filed under the same attachments — it is not
    // an executed instrument, so exclude it from the gate.
    const { data: memoPdf } = await supabase
      .from('pri_memo_pdfs')
      .select('attachment_id')
      .eq('pri_id', priId)
      .maybeSingle()

    let attachmentQuery = supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'pri')
      .eq('entity_id', priId)
    if (memoPdf?.attachment_id) {
      attachmentQuery = attachmentQuery.neq('id', memoPdf.attachment_id)
    }
    const { count: attachmentCount } = await attachmentQuery

    if (!attachmentCount || attachmentCount === 0) {
      throw new ActionError(
        'Attach the executed instrument (the SAFE, note, or agreement) before funding this PRI.'
      )
    }

    const method = requiredString(formData, 'method') as 'check' | 'ach' | 'wire'
    if (!['check', 'ach', 'wire'].includes(method)) throw new ActionError('Invalid method')

    const { error } = await supabase
      .from('pris')
      .update({
        status: 'funded' as PriStatus,
        funded_date: optionalString(formData, 'funded_date') ?? (await orgToday(supabase)),
        method,
      })
      .eq('id', priId)

    if (error) throw new ActionError(error.message)

    // Refresh the filed memo PDF so its Key dates / Status rows show the
    // funding. Best effort: a render hiccup must never roll back the funding.
    // A failure is deliberately ignored: anyone can regenerate from the PRI page.
    await generatePriMemorandum(priId)

    revalidatePath('/pris')
    revalidatePath(`/pris/${priId}`)
  })
}

/** Later lifecycle events: conversion, repayment, exit, write-off. */
export async function setPriStatus(priId: string, status: PriStatus) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    if (status === 'committed') throw new ActionError('A PRI cannot return to committed')

    const { data: pri } = await supabase
      .from('pris')
      .select('status')
      .eq('id', priId)
      .single()

    if (!pri) throw new ActionError('PRI not found')
    if (pri.status === 'committed') {
      throw new ActionError('Fund the PRI first — use Mark funded, which checks the compliance file')
    }

    const { error } = await supabase.from('pris').update({ status }).eq('id', priId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/pris')
    revalidatePath(`/pris/${priId}`)
  })
}
