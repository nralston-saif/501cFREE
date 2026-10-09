'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAdminId, requiredString, optionalString, ActionError, runAction } from './helpers'
import { parseDollarsToCents } from '@/lib/utils/money'
import { syncExpenseToQbo, deleteExpenseFromQbo } from '@/lib/quickbooks/sync'
import type { ExpensePaymentMethod, ExpenseStatus, FunctionalClass } from '@/lib/supabase/types/database'

function expenseFields(formData: FormData) {
  const amountCents = parseDollarsToCents(requiredString(formData, 'amount'))
  if (amountCents === null) throw new ActionError('Invalid amount')

  return {
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
  }
}

export async function createExpense(formData: FormData) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('expenses')
      .insert({ ...expenseFields(formData), entered_by: memberId })
      .select('id')
      .single()

    if (error) throw new ActionError(error.message)

    // Push to QuickBooks after the response — the sync chains token refresh +
    // QBO API calls (seconds); failures land on the row's qbo_sync_status with
    // its existing retry path, so the save never waits on it.
    after(() => syncExpenseToQbo(supabase, data.id))

    revalidatePath('/expenses')
    redirect(`/expenses/${data.id}`)
  })
}

export async function updateExpense(expenseId: string, formData: FormData) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('expenses')
      .update(expenseFields(formData))
      .eq('id', expenseId)

    if (error) throw new ActionError(error.message)

    after(() => syncExpenseToQbo(supabase, expenseId))

    revalidatePath('/expenses')
    revalidatePath(`/expenses/${expenseId}`)
  })
}

export async function deleteExpense(expenseId: string) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const { data: expense } = await supabase
      .from('expenses')
      .select('qbo_purchase_id, qbo_source')
      .eq('id', expenseId)
      .maybeSingle()

    const { data: attachmentRows } = await supabase
      .from('attachments')
      .select('id, storage_path')
      .eq('entity_type', 'expense')
      .eq('entity_id', expenseId)

    const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
    if (error) throw new ActionError(error.message)

    // attachments is polymorphic (no FK), so its rows and their files in the
    // documents bucket outlive the expense unless removed here. Best effort:
    // the expense is already gone, so a cleanup failure is only logged.
    const attachments = attachmentRows ?? []
    if (attachments.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove(attachments.map((a) => a.storage_path))
      if (storageError) console.error('deleteExpense: could not remove files', storageError.message)
      const { error: rowsError } = await supabase
        .from('attachments')
        .delete()
        .in('id', attachments.map((a) => a.id))
      if (rowsError) console.error('deleteExpense: could not remove attachment rows', rowsError.message)
    }

    // Only app-owned transactions are deleted in QBO. Deleting a record that
    // was pulled from QBO just unlinks it locally — QBO's books stay intact.
    if (expense?.qbo_purchase_id && expense.qbo_source !== 'qbo') {
      const qboPurchaseId = expense.qbo_purchase_id
      after(() => deleteExpenseFromQbo(qboPurchaseId))
    }

    revalidatePath('/expenses')
    redirect('/expenses')
  })
}

export async function upsertCategory(formData: FormData) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const id = optionalString(formData, 'id')
    const fields = {
      name: requiredString(formData, 'name'),
      functional_class: requiredString(formData, 'functional_class') as FunctionalClass,
      form_990_line: optionalString(formData, 'form_990_line'),
      is_active: formData.get('is_active') !== 'off',
    }

    const { error } = id
      ? await supabase.from('expense_categories').update(fields).eq('id', id)
      : await supabase.from('expense_categories').insert(fields)

    if (error) throw new ActionError(error.message)

    revalidatePath('/expenses/categories')
  })
}

export async function setCategoryActive(categoryId: string, isActive: boolean) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('expense_categories')
      .update({ is_active: isActive })
      .eq('id', categoryId)

    if (error) throw new ActionError(error.message)
    revalidatePath('/expenses/categories')
  })
}
