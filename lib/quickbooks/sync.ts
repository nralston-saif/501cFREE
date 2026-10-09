import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  Expense,
  Json,
  QboMapping,
} from '@/lib/supabase/types/database'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { awaitsBankPayment, canSendToQuickBooks } from '@/lib/expenses/payment'
import { getValidConnection, QboError } from './client'
import { echoMarker } from './echo'
import {
  attachFileToPurchase,
  createPurchase,
  createVendor,
  deletePurchase,
  findVendorByName,
  getPurchase,
  listAttachmentNames,
  listPaymentAccounts,
  updatePurchase,
  type QboPulledPurchase,
} from './api'

/**
 * Keeping QuickBooks in step with expenses. Bank feeds are the source of
 * cash transactions in QBO, so the app NEVER creates a QBO transaction on its own
 * (that double-counted payments the feed also brought in). After an expense
 * is saved:
 *
 * - Matched to a bank-feed transaction (qbo_source='qbo'): fill in that
 *   transaction's payee, category, 990 class, description and receipts
 *   (enrichPurchase). Amount, date and bank account are never touched — they
 *   tie the transaction to the bank statement.
 * - Sent from the app earlier (qbo_source='app' with a purchase id): update it,
 *   keeping the account it was paid from.
 * - Not in QBO yet: nothing. It arrives through the bank feed and is matched
 *   in Banking, or an admin uses "Send to QuickBooks" (sendExpenseToQbo) for
 *   a payment no feed will ever bring in.
 *
 * Never throws: the expense save must succeed whether or not QuickBooks is
 * reachable. Failures land in qbo_sync_status='failed' + qbo_sync_error and
 * can be retried from the expense page.
 */
export async function syncExpenseToQbo(
  supabase: SupabaseClient<Database>,
  expenseId: string
): Promise<{ ok: boolean; error?: string }> {
  return withConnection(supabase, expenseId, async (conn) => {
    const expense = await loadExpense(supabase, expenseId)
    if (!expense.qbo_purchase_id) {
      await supabase
        .from('expenses')
        .update({ qbo_sync_status: 'not_synced', qbo_sync_error: null })
        .eq('id', expenseId)
      return
    }
    const mappings = await loadMappings(supabase)
    if (expense.qbo_source === 'qbo') {
      await enrichPurchase(supabase, conn, expense, mappings)
    } else {
      await updateOwnedPurchase(supabase, conn, expense, mappings)
    }
  })
}

/**
 * Create the QBO transaction for an expense no bank feed will bring in
 * (e.g. a grant wired from the investment account, a reimbursement to a team member),
 * paid from `paymentAccountId`. Explicit, from the expense page only.
 */
export async function sendExpenseToQbo(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  paymentAccountId: string
): Promise<{ ok: boolean; error?: string }> {
  // Checked before withConnection so a refusal isn't recorded as a sync failure
  const refusal = await sendRefusal(supabase, expenseId)
  if (refusal) return { ok: false, error: refusal }
  return withConnection(supabase, expenseId, async (conn) => {
    const expense = await loadExpense(supabase, expenseId)
    if (awaitsBankPayment(expense)) {
      throw new QboError(
        "This invoice is still unpaid. Mark it paid first, or let its bank payment be matched in Banking."
      )
    }
    const account = (await listPaymentAccounts(conn)).find((a) => a.Id === paymentAccountId)
    if (!account) throw new QboError('Pick the account this was paid from.')

    const mappings = await loadMappings(supabase)
    const body = await buildPurchaseBody(supabase, conn, expense, mappings, {
      accountId: account.Id,
      paymentType:
        account.AccountType === 'Credit Card'
          ? 'CreditCard'
          : account.AccountType === 'Bank' && expense.payment_method === 'check'
            ? 'Check'
            : 'Cash',
    })
    const purchase = await createPurchase(conn, body)
    await attachMissingReceipts(conn, expenseId, purchase.Id)
    await supabase
      .from('expenses')
      .update({
        qbo_purchase_id: purchase.Id,
        qbo_source: 'app',
        qbo_sync_status: 'synced',
        qbo_synced_at: new Date().toISOString(),
        qbo_sync_error: null,
      })
      .eq('id', expenseId)
  })
}

/** Why "Send to QuickBooks" must not run for this expense, or null if it may. */
async function sendRefusal(
  supabase: SupabaseClient<Database>,
  expenseId: string
): Promise<string | null> {
  const [{ data: expense }, { data: linked }] = await Promise.all([
    supabase.from('expenses').select('qbo_purchase_id, qbo_source').eq('id', expenseId).maybeSingle(),
    supabase
      .from('qbo_inbox')
      .select('id')
      .eq('expense_id', expenseId)
      .in('status', ['approved', 'auto_applied'])
      .limit(1),
  ])
  if (!expense) return 'Expense not found'
  if (canSendToQuickBooks(expense, (linked ?? []).length > 0)) return null
  return expense.qbo_purchase_id
    ? 'This expense is already in QuickBooks.'
    : 'This expense came from a QuickBooks transaction, so it is already on the books. Sending it would book it twice.'
}

type Conn = NonNullable<Awaited<ReturnType<typeof getValidConnection>>>

async function withConnection(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  run: (conn: Conn) => Promise<void>
): Promise<{ ok: boolean; error?: string }> {
  if (isDemoMode()) return { ok: true }
  try {
    const conn = await getValidConnection()
    if (!conn) return { ok: true } // not connected — nothing to do
    await run(conn)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown QuickBooks sync error'
    await recordFailure(supabase, expenseId, message)
    return { ok: false, error: message }
  }
}

async function loadExpense(
  supabase: SupabaseClient<Database>,
  expenseId: string
): Promise<ExpenseWithJoins> {
  const { data: expense } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .maybeSingle()
  if (!expense) throw new QboError('Expense not found')

  const [{ data: category }, { data: vendor }] = await Promise.all([
    supabase
      .from('expense_categories')
      .select('id, name, functional_class')
      .eq('id', expense.category_id)
      .maybeSingle(),
    expense.vendor_contact_id
      ? supabase
          .from('contacts')
          .select('id, display_name, qbo_vendor_id')
          .eq('id', expense.vendor_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return { ...expense, category: category ?? null, vendor: vendor ?? null }
}

/** Update a transaction the app created earlier, keeping the account it was paid from. */
async function updateOwnedPurchase(
  supabase: SupabaseClient<Database>,
  conn: Conn,
  expense: ExpenseWithJoins,
  mappings: MappingIndex
): Promise<void> {
  const existing = (await getPurchase(conn, expense.qbo_purchase_id!)) as QboPulledPurchase | null
  if (!existing) {
    throw new QboError(
      'This expense\'s QuickBooks transaction no longer exists (deleted in QuickBooks?). Use "Send to QuickBooks" to add it again if it should be there.'
    )
  }
  const body = await buildPurchaseBody(supabase, conn, expense, mappings, {
    accountId: existing.AccountRef?.value ?? '',
    paymentType: existing.PaymentType ?? 'Cash',
  })
  await updatePurchase(conn, { ...body, Id: existing.Id, SyncToken: existing.SyncToken })
  await refreshInboxRaw(supabase, conn, existing.Id)
  await recordSynced(supabase, expense.id, null)
}

/**
 * Fill in a bank-feed transaction from its matched expense: payee, category
 * and 990 class (single-line transactions only — splits stay as they are),
 * line description, and any receipts not attached yet.
 */
async function enrichPurchase(
  supabase: SupabaseClient<Database>,
  conn: Conn,
  expense: ExpenseWithJoins,
  mappings: MappingIndex
): Promise<void> {
  const existing = (await getPurchase(conn, expense.qbo_purchase_id!)) as QboPulledPurchase | null
  if (!existing) {
    throw new QboError("This expense's QuickBooks transaction no longer exists (deleted in QuickBooks?).")
  }

  const notes: string[] = []
  // Bank-tied fields are sent back unchanged.
  const update: Record<string, unknown> & { Id: string; SyncToken: string } = {
    Id: existing.Id,
    SyncToken: existing.SyncToken,
    ...(existing.PaymentType ? { PaymentType: existing.PaymentType } : {}),
    ...(existing.AccountRef ? { AccountRef: existing.AccountRef } : {}),
    ...(existing.TxnDate ? { TxnDate: existing.TxnDate } : {}),
  }

  if (expense.vendor) {
    const vendorId = await ensureVendor(supabase, conn, expense.vendor, expense.is_1099_eligible)
    update.EntityRef = { value: vendorId, type: 'Vendor' }
  }

  const lines = existing.Line ?? []
  const line = lines[0]
  if (lines.length === 1 && line?.DetailType === 'AccountBasedExpenseLineDetail') {
    const categoryMapping = expense.category ? mappings.get(`category:${expense.category.id}`) : undefined
    const classMapping = expense.category
      ? mappings.get(`functional_class:${expense.category.functional_class}`)
      : undefined
    if (expense.category && !categoryMapping) {
      notes.push(
        `"${expense.category.name}" isn't mapped to a QuickBooks account in Settings, so QuickBooks kept its own category.`
      )
    }
    update.Line = [
      {
        // Only writable line fields; keeping Id and Amount ties it to the same line.
        ...(line.Id ? { Id: line.Id } : {}),
        Amount: line.Amount,
        DetailType: line.DetailType,
        Description: expense.description,
        AccountBasedExpenseLineDetail: {
          ...line.AccountBasedExpenseLineDetail,
          ...(categoryMapping ? { AccountRef: { value: categoryMapping.qbo_id } } : {}),
          ...(classMapping ? { ClassRef: { value: classMapping.qbo_id } } : {}),
        },
      },
    ]
  } else {
    notes.push('This payment is split across several lines in QuickBooks, so its categories were left as they are.')
  }

  await updatePurchase(conn, update)
  await attachMissingReceipts(conn, expense.id, existing.Id)
  await refreshInboxRaw(supabase, conn, existing.Id)
  await recordSynced(supabase, expense.id, notes.length > 0 ? notes.join(' ') : null)
}

/**
 * Store the post-edit transaction on its Banking row, so the next pull sees
 * the version the app just wrote rather than a change made in QuickBooks.
 */
async function refreshInboxRaw(
  supabase: SupabaseClient<Database>,
  conn: Conn,
  purchaseId: string
): Promise<void> {
  const fresh = await getPurchase(conn, purchaseId)
  if (!fresh) return
  await supabase
    .from('qbo_inbox')
    .update({ raw: fresh as unknown as Json })
    .eq('qbo_entity_type', 'Purchase')
    .eq('qbo_entity_id', purchaseId)
}

async function recordSynced(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  note: string | null
): Promise<void> {
  // qbo_sync_error doubles as an informational note while status is synced.
  await supabase
    .from('expenses')
    .update({
      qbo_sync_status: 'synced',
      qbo_synced_at: new Date().toISOString(),
      qbo_sync_error: note,
    })
    .eq('id', expenseId)
}

/** Best-effort delete of the QBO Purchase when an expense is deleted locally. */
export async function deleteExpenseFromQbo(qboPurchaseId: string): Promise<void> {
  if (isDemoMode()) return
  try {
    const conn = await getValidConnection()
    if (!conn) return
    await deletePurchase(conn, qboPurchaseId)
  } catch {
    // The local delete proceeds either way; the accountant reconciles QBO.
  }
}

async function recordFailure(
  supabase: SupabaseClient<Database>,
  expenseId: string,
  message: string
): Promise<void> {
  await supabase
    .from('expenses')
    .update({ qbo_sync_status: 'failed', qbo_sync_error: message.slice(0, 1000) })
    .eq('id', expenseId)
}

type MappingIndex = Map<string, QboMapping>

async function loadMappings(supabase: SupabaseClient<Database>): Promise<MappingIndex> {
  const { data } = await supabase.from('qbo_mappings').select('*')
  const index: MappingIndex = new Map()
  for (const m of data ?? []) index.set(`${m.mapping_type}:${m.local_key}`, m)
  return index
}

type ExpenseWithJoins = Expense & {
  category: { id: string; name: string; functional_class: string } | null
  vendor: { id: string; display_name: string; qbo_vendor_id: string | null } | null
}

async function buildPurchaseBody(
  supabase: SupabaseClient<Database>,
  conn: Conn,
  expense: ExpenseWithJoins,
  mappings: MappingIndex,
  paidFrom: { accountId: string; paymentType: string }
): Promise<Record<string, unknown>> {
  if (!expense.category) throw new QboError('Expense has no category')

  const categoryMapping = mappings.get(`category:${expense.category.id}`)
  if (!categoryMapping) {
    throw new QboError(
      `Category "${expense.category.name}" is not mapped to a QuickBooks account. Map it in Settings → QuickBooks.`
    )
  }
  if (!paidFrom.accountId) throw new QboError('No QuickBooks account to pay from.')

  const classMapping = mappings.get(`functional_class:${expense.category.functional_class}`)

  const line: Record<string, unknown> = {
    Amount: centsToAmount(expense.amount_cents),
    DetailType: 'AccountBasedExpenseLineDetail',
    Description: expense.description,
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: categoryMapping.qbo_id },
      ...(classMapping ? { ClassRef: { value: classMapping.qbo_id } } : {}),
    },
  }

  const body: Record<string, unknown> = {
    TxnDate: expense.expense_date,
    PaymentType: paidFrom.paymentType,
    AccountRef: { value: paidFrom.accountId },
    Line: [line],
    PrivateNote: [echoMarker(expense.id), expense.notes]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 4000),
  }

  if (expense.vendor) {
    const vendorId = await ensureVendor(supabase, conn, expense.vendor, expense.is_1099_eligible)
    body.EntityRef = { value: vendorId, type: 'Vendor' }
  }

  return body
}

async function ensureVendor(
  supabase: SupabaseClient<Database>,
  conn: Conn,
  vendor: { id: string; display_name: string; qbo_vendor_id: string | null },
  is1099Eligible: boolean
): Promise<string> {
  if (vendor.qbo_vendor_id) return vendor.qbo_vendor_id

  const existing = await findVendorByName(conn, vendor.display_name)
  const qboVendor =
    existing ??
    (await createVendor(conn, {
      DisplayName: vendor.display_name,
      ...(is1099Eligible ? { Vendor1099: true } : {}),
    }))

  await supabase
    .from('contacts')
    .update({ qbo_vendor_id: qboVendor.Id })
    .eq('id', vendor.id)
  return qboVendor.Id
}

/**
 * Attach the expense's receipt files to a Purchase, skipping files already
 * attached by name. If QBO's attachment list can't be read, attach nothing
 * rather than risk duplicates.
 */
async function attachMissingReceipts(conn: Conn, expenseId: string, purchaseId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: attachments } = await admin
    .from('attachments')
    .select('storage_path, file_name, mime_type')
    .eq('entity_type', 'expense')
    .eq('entity_id', expenseId)
  if (!attachments || attachments.length === 0) return

  let already: Set<string>
  try {
    already = new Set(await listAttachmentNames(conn, purchaseId))
  } catch {
    return
  }

  for (const attachment of attachments) {
    if (already.has(attachment.file_name)) continue
    try {
      const { data: blob } = await admin.storage
        .from('documents')
        .download(attachment.storage_path)
      if (!blob) continue
      await attachFileToPurchase(conn, purchaseId, {
        name: attachment.file_name,
        contentType: attachment.mime_type ?? 'application/octet-stream',
        bytes: new Uint8Array(await blob.arrayBuffer()),
      })
    } catch {
      // Receipts are nice-to-have on the QBO side; the transaction itself synced.
    }
  }
}

function centsToAmount(cents: number): number {
  return Number((cents / 100).toFixed(2))
}
