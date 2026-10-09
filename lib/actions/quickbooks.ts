'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdminId, ActionError, runAction } from './helpers'
import { disconnect } from '@/lib/quickbooks/client'
import { sendExpenseToQbo, syncExpenseToQbo } from '@/lib/quickbooks/sync'
import type { QboMappingType } from '@/lib/supabase/types/database'

export async function disconnectQuickBooks() {
  return runAction(async () => {
    await requireAdminId()
    await disconnect()
    revalidatePath('/settings')
  })
}

/**
 * Saves the QuickBooks entity mappings from the settings form. Fields are
 * named `map:<mapping_type>:<local_key>` with value `<qbo_id>::<qbo_name>`
 * (empty value clears the mapping).
 */
export async function saveQboMappings(formData: FormData) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const MAPPING_TYPES: QboMappingType[] = ['category', 'functional_class', 'payment_method']

    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('map:') || typeof value !== 'string') continue
      const [, rawType, localKey] = key.split(':')
      const mappingType = MAPPING_TYPES.find((t) => t === rawType)
      if (!mappingType || !localKey) continue

      if (value === '') {
        const { error } = await supabase
          .from('qbo_mappings')
          .delete()
          .eq('mapping_type', mappingType)
          .eq('local_key', localKey)
        if (error) throw new ActionError(error.message)
        continue
      }

      const sep = value.indexOf('::')
      const { error } = await supabase.from('qbo_mappings').upsert(
        {
          mapping_type: mappingType,
          local_key: localKey,
          qbo_id: sep === -1 ? value : value.slice(0, sep),
          qbo_name: sep === -1 ? null : value.slice(sep + 2),
        },
        { onConflict: 'mapping_type,local_key' }
      )
      if (error) throw new ActionError(error.message)
    }

    revalidatePath('/settings')
  })
}

/** Pull-sync settings from the QuickBooks card (toggles + backfill floor). */
export async function saveQboPullSettings(formData: FormData) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const pullSince = formData.get('pull_since')
    const { error } = await supabase
      .from('qbo_sync_state')
      .update({
        pull_enabled: formData.get('pull_enabled') === 'on',
        auto_apply_enabled: formData.get('auto_apply_enabled') === 'on',
        ...(typeof pullSince === 'string' && pullSince !== '' ? { pull_since: pullSince } : {}),
      })
      .eq('id', 1)
    if (error) throw new ActionError(error.message)

    revalidatePath('/settings')
    revalidatePath('/banking')
  })
}

/** Manual (re)sync of one expense, from the expense page. */
export async function retryExpenseSync(expenseId: string) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const result = await syncExpenseToQbo(supabase, expenseId)
    revalidatePath('/expenses')
    revalidatePath(`/expenses/${expenseId}`)
    if (!result.ok) throw new ActionError(result.error ?? 'QuickBooks sync failed')
  })
}

/**
 * Create the QuickBooks transaction for a payment no bank feed will bring in
 * (from the expense page's "Send to QuickBooks").
 */
export async function sendExpenseToQuickBooks(expenseId: string, formData: FormData) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const accountId = formData.get('payment_account_id')
    if (typeof accountId !== 'string' || !accountId) throw new ActionError('Pick the account this was paid from')

    const result = await sendExpenseToQbo(supabase, expenseId, accountId)
    revalidatePath('/expenses')
    revalidatePath(`/expenses/${expenseId}`)
    if (!result.ok) throw new ActionError(result.error ?? 'Could not send to QuickBooks')
  })
}
