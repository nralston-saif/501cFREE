'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { requireAdminId, ActionError, actionErrorMessage } from './helpers'
import { syncExpenseToQbo } from '@/lib/quickbooks/sync'
import { checkInvoiceFile, INVOICE_UPLOAD_PREFIX } from '@/lib/invoices/formats'
import { findVendorByNames } from '@/lib/invoices/vendor-groups'
import { normalizeName } from '@/lib/quickbooks/match'
import { createVendorInline } from './contacts'
import type { ContactKind, ExpenseStatus } from '@/lib/supabase/types/database'

/**
 * Bulk invoice/receipt upload (/expenses/upload). The browser uploads each
 * file straight to the documents bucket under expense-import/ through a
 * one-time signed upload URL minted here (no request body cap, and it always
 * targets this app's Supabase project — the browser-side Supabase env can't be trusted
 * for that), the extract route reads it, an admin reviews every row, and
 * createExpenseFromUpload files each one as an expense with the file attached
 * in place — the object never moves.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

function errorMessage(err: unknown, fallback: string): string {
  return actionErrorMessage(err, fallback)
}

function assertUploadPath(path: string) {
  if (!path.startsWith(INVOICE_UPLOAD_PREFIX) || path.includes('..')) {
    throw new ActionError('Invalid upload path')
  }
}

/**
 * Mint a one-time upload URL for one file. `signedUrl` is null in demo mode,
 * where the browser stages through stageInvoiceFile instead.
 */
export async function createInvoiceUploadUrl(
  fileName: string,
  size: number
): Promise<Result<{ path: string; signedUrl: string | null }>> {
  try {
    await requireAdminId()
    const check = checkInvoiceFile(fileName, size)
    if (!check.ok) throw new ActionError(check.reason)
    const path = `${INVOICE_UPLOAD_PREFIX}${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    if (isDemoMode()) return { ok: true, path, signedUrl: null }

    const supabase = await createClient()
    const { data, error } = await supabase.storage.from('documents').createSignedUploadUrl(path)
    if (error || !data) throw new ActionError(`Couldn't start the upload: ${error?.message ?? 'unknown error'}`)
    return { ok: true, path, signedUrl: data.signedUrl }
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't start the upload") }
  }
}

/** Demo-mode staging (no real storage to sign against). */
export async function stageInvoiceFile(formData: FormData): Promise<Result<{ path: string }>> {
  try {
    await requireAdminId()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new ActionError('No file provided')
    const check = checkInvoiceFile(file.name, file.size)
    if (!check.ok) throw new ActionError(check.reason)

    const supabase = await createClient()
    const path = `${INVOICE_UPLOAD_PREFIX}${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: check.mime })
    if (error) throw new ActionError(`Upload failed: ${error.message}`)
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Upload failed') }
  }
}

export type UploadedExpenseInput = {
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  expense_date: string
  amount_cents: number
  description: string
  category_id: string
  vendor_contact_id: string | null
  status: ExpenseStatus
  is_1099_eligible: boolean
}

/** File one reviewed upload as an expense, attaching the uploaded file as its receipt. */
export async function createExpenseFromUpload(
  input: UploadedExpenseInput
): Promise<Result<{ id: string; warning: string | null }>> {
  try {
    const memberId = await requireAdminId()
    assertUploadPath(input.storage_path)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expense_date)) throw new ActionError('Date is required')
    if (!Number.isInteger(input.amount_cents) || input.amount_cents < 0) {
      throw new ActionError('Amount is required')
    }
    if (!input.description.trim()) throw new ActionError('Description is required')
    if (!input.category_id) throw new ActionError('Category is required')
    if (!['pending', 'paid'].includes(input.status)) throw new ActionError('Invalid status')

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        expense_date: input.expense_date,
        amount_cents: input.amount_cents,
        description: input.description.trim(),
        category_id: input.category_id,
        vendor_contact_id: input.vendor_contact_id || null,
        status: input.status,
        is_1099_eligible: input.is_1099_eligible,
        entered_by: memberId,
      })
      .select('id')
      .single()
    if (error) throw new ActionError(error.message)

    const { error: attachError } = await supabase.from('attachments').insert({
      entity_type: 'expense',
      entity_id: data.id,
      storage_path: input.storage_path,
      file_name: input.file_name,
      mime_type: input.mime_type || null,
      size_bytes: input.size_bytes,
      uploaded_by: memberId,
    })
    // The expense is saved either way; a missing receipt can be re-uploaded
    // from the expense page.

    // Pending invoices are skipped by the push; paid ones go to QBO with the
    // receipt attached (hence after the attachment row).
    after(() => syncExpenseToQbo(supabase, data.id))

    revalidatePath('/expenses')
    return {
      ok: true,
      id: data.id,
      warning: attachError ? `The file didn't attach (${attachError.message}). Re-upload it on the expense.` : null,
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Could not create the expense') }
  }
}

/**
 * Create the vendor proposed from an uploaded invoice — unless one with the
 * same name (ignoring case, punctuation, LLC/Inc) already exists, which is
 * returned instead. Guards against duplicates from double clicks, two
 * invoices from the same new vendor, or two admins uploading at once.
 */
export async function createVendorForUpload(input: {
  name: string
  kind: ContactKind
}): Promise<Result<{ vendor: { id: string; display_name: string }; existed: boolean }>> {
  try {
    await requireAdminId()
    const name = input.name.trim()
    if (!name) throw new ActionError('Vendor name is required')

    const supabase = await createClient()
    const { data: vendors } = await supabase
      .from('contacts')
      .select('id, display_name')
      .eq('is_vendor', true)
    const existing = findVendorByNames([normalizeName(name)], vendors ?? [])
    if (existing) return { ok: true, vendor: existing, existed: true }

    const created = await createVendorInline({ name, kind: input.kind })
    if (!created.ok) throw new ActionError(created.error)
    return { ok: true, vendor: created.vendor, existed: false }
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'Could not create the vendor') }
  }
}

/** Remove an uploaded file the admin dropped from the batch. Best effort. */
export async function discardInvoiceUpload(storagePath: string): Promise<void> {
  try {
    await requireAdminId()
    assertUploadPath(storagePath)
    const supabase = await createClient()
    // Never remove a file that has already been filed onto an expense.
    const { data: attached } = await supabase
      .from('attachments')
      .select('id')
      .eq('storage_path', storagePath)
      .limit(1)
    if (attached && attached.length > 0) return
    await supabase.storage.from('documents').remove([storagePath])
  } catch {
    // Orphaned uploads are harmless; nothing to surface.
  }
}
