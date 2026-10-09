import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Disbursement, Expense, Json, QboInboxItem, QboSyncState } from '@/lib/supabase/types/database'
import { fetchAll, fetchByKeys } from '@/lib/supabase/fetch-all'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { getValidConnection } from './client'
import { listAllAccounts } from './api'
import { CDC_ENTITIES, changedDataCapture, listChangedSince, type CdcRecord } from './cdc'
import { normalizeEntity, type NormalizedTxn } from './normalize'
import { matchTransaction, type MatchContext, type Suggestion } from './match'
import { applyDisbursementPaid } from '@/lib/grants/disburse'
import { awaitsBankPayment } from '@/lib/expenses/payment'
import { parseEchoMarker } from './echo'

/**
 * The QBO pull sync. Reads transactions changed in QuickBooks since the
 * cursor, lands them in qbo_inbox for admin review, and auto-applies
 * the one safe case: an exact match against a scheduled grant disbursement.
 *
 * Never throws — the outcome (including errors) is written to
 * qbo_sync_state and returned. Never writes to QBO.
 */

export type PullStats = {
  skipped?: string
  pulled: number
  new: number
  changed: number
  deleted: number
  echoes: number
  auto_applied: number
  errors: string[]
}

const emptyStats = (): PullStats => ({
  pulled: 0,
  new: 0,
  changed: 0,
  deleted: 0,
  echoes: 0,
  auto_applied: 0,
  errors: [],
})

// CDC only looks back 30 days; beyond 25 we re-bootstrap with plain queries.
const CDC_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000
// Overlap the cursor to survive clock skew; the unique constraint dedupes.
const CURSOR_OVERLAP_MS = 10 * 60 * 1000

export async function runQboPull(supabase: SupabaseClient<Database>): Promise<PullStats> {
  const stats = emptyStats()
  if (isDemoMode()) return { ...stats, skipped: 'demo mode' }

  const { data: state } = await supabase
    .from('qbo_sync_state')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (!state) return { ...stats, skipped: 'no sync state row' }
  if (!state.pull_enabled) return { ...stats, skipped: 'pull disabled' }

  const runStart = Date.now()
  try {
    const conn = await getValidConnection()
    if (!conn) {
      return finishRun(supabase, stats, null, 'QuickBooks is not connected')
    }

    const records = await fetchChanged(conn, state)
    stats.pulled = records.length

    // Every waiting item (paged past max_rows), so none silently skips re-matching
    const waiting = await fetchAll<QboInboxItem>(() =>
      supabase.from('qbo_inbox').select('*').eq('status', 'pending').eq('kind', 'new').order('id')
    )

    if (records.length > 0 || waiting.length > 0) {
      const ctx = await loadMatchContext(supabase, conn)
      const echoIndex = await loadEchoIndex(supabase)
      const autoApply = state.auto_apply_enabled

      for (const record of records) {
        try {
          await processRecord(supabase, record, ctx, echoIndex, autoApply, stats)
        } catch (error) {
          stats.errors.push(
            `${record.entityType} ${record.entity.Id}: ${error instanceof Error ? error.message : 'unknown error'}`
          )
        }
      }

      // Items still awaiting review are re-matched every run, so records
      // created in the app after the bank transaction arrived (e.g. an invoice
      // uploaded later) still get suggested.
      const touched = new Set(records.map((r) => `${r.entityType}:${r.entity.Id}`))
      for (const item of waiting) {
        if (touched.has(`${item.qbo_entity_type}:${item.qbo_entity_id}`)) continue
        try {
          await rematchWaitingItem(supabase, item, ctx)
        } catch (error) {
          stats.errors.push(
            `re-match ${item.qbo_entity_type} ${item.qbo_entity_id}: ${error instanceof Error ? error.message : 'unknown error'}`
          )
        }
      }
    }

    const newCursor = new Date(runStart - CURSOR_OVERLAP_MS).toISOString()
    return finishRun(supabase, stats, newCursor, null)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown QuickBooks pull error'
    stats.errors.push(message)
    return finishRun(supabase, stats, null, message)
  }
}

async function fetchChanged(
  conn: NonNullable<Awaited<ReturnType<typeof getValidConnection>>>,
  state: QboSyncState
): Promise<CdcRecord[]> {
  const cursorMs = state.last_cdc_at ? new Date(state.last_cdc_at).getTime() : null
  const cursorUsable = cursorMs !== null && Date.now() - cursorMs < CDC_MAX_AGE_MS

  if (cursorUsable) {
    return changedDataCapture(conn, CDC_ENTITIES, new Date(cursorMs).toISOString())
  }

  // Bootstrap (or stale cursor): full paged queries from the backfill floor.
  const sinceMs = Math.max(
    new Date(`${state.pull_since}T00:00:00Z`).getTime(),
    cursorMs ?? 0
  )
  const sinceISO = new Date(sinceMs).toISOString()
  const all: CdcRecord[] = []
  for (const entityType of CDC_ENTITIES) {
    all.push(...(await listChangedSince(conn, entityType, sinceISO)))
  }
  return all
}

type UnpushedExpense = Pick<
  Expense,
  | 'id'
  | 'amount_cents'
  | 'expense_date'
  | 'description'
  | 'vendor_contact_id'
  | 'category_id'
  | 'status'
  | 'paid_by'
  | 'payment_method'
  | 'qbo_purchase_id'
>

type EchoIndex = {
  byPurchaseId: Map<string, string> // qbo_purchase_id -> expense id
}

async function loadEchoIndex(supabase: SupabaseClient<Database>): Promise<EchoIndex> {
  // Every app-pushed expense: a truncated index would land the app's own
  // Purchases in the inbox as new bank transactions.
  const data = await fetchAll<{ id: string; qbo_purchase_id: string | null; qbo_source: string }>(() =>
    supabase
      .from('expenses')
      .select('id, qbo_purchase_id, qbo_source')
      .not('qbo_purchase_id', 'is', null)
      .eq('qbo_source', 'app')
      .order('id')
  )
  const byPurchaseId = new Map<string, string>()
  for (const row of data) {
    // Only app-owned rows are echoes; pulled rows are already inbox-tracked.
    if (row.qbo_purchase_id && row.qbo_source === 'app') {
      byPurchaseId.set(row.qbo_purchase_id, row.id)
    }
  }
  return { byPurchaseId }
}

async function loadMatchContext(
  supabase: SupabaseClient<Database>,
  conn: NonNullable<Awaited<ReturnType<typeof getValidConnection>>>
): Promise<MatchContext> {
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const ninetyDaysAgo = daysAgo(90)

  // Matching candidates must be complete (paged past max_rows): a truncated
  // list would silently miss matches.
  const [contacts, disbursements, expenses, pris, { data: mappings }, accounts] = await Promise.all([
    fetchAll<{ id: string; display_name: string; qbo_vendor_id: string | null }>(() =>
      supabase.from('contacts').select('id, display_name, qbo_vendor_id').order('id')
    ),
    fetchAll<Disbursement>(() => supabase.from('disbursements').select('*').eq('status', 'scheduled').order('id')),
    // Unpushed expenses: recent ones for link_expense, plus open invoices,
    // which can wait a while for payment.
    fetchAll<UnpushedExpense>(() =>
      supabase
        .from('expenses')
        .select(
          'id, amount_cents, expense_date, description, vendor_contact_id, category_id, status, paid_by, payment_method, qbo_purchase_id'
        )
        .is('qbo_purchase_id', null)
        .gte('expense_date', daysAgo(365))
        .order('id')
    ),
    fetchAll<{ id: string; amount_cents: number; recipient_contact_id: string }>(() =>
      supabase.from('pris').select('id, amount_cents, recipient_contact_id').eq('status', 'committed').order('id')
    ),
    supabase.from('qbo_mappings').select('*'),
    listAllAccounts(conn),
  ])

  const contactById = new Map(contacts.map((c) => [c.id, c]))

  const unpushed = expenses
  const expenseCandidate = (e: (typeof unpushed)[number]) => {
    const vendor = e.vendor_contact_id ? contactById.get(e.vendor_contact_id) : null
    return {
      id: e.id,
      amount_cents: e.amount_cents,
      expense_date: e.expense_date,
      description: e.description,
      vendor_contact_id: e.vendor_contact_id,
      vendor_name: vendor?.display_name ?? null,
      vendor_qbo_vendor_id: vendor?.qbo_vendor_id ?? null,
    }
  }

  const awards = await fetchByKeys<{ id: string; grantee_contact_id: string; agreement_signed_date: string | null }, string>(
    disbursements.map((d) => d.grant_out_id),
    (ids) => supabase.from('grants_out').select('id, grantee_contact_id, agreement_signed_date').in('id', ids)
  )
  const awardById = new Map(awards.map((a) => [a.id, a]))

  const categoryByQboAccount: Record<string, string> = {}
  const paymentMethodByQboAccount: Record<string, string> = {}
  for (const m of mappings ?? []) {
    if (m.mapping_type === 'category') categoryByQboAccount[m.qbo_id] = m.local_key
    if (m.mapping_type === 'payment_method' && m.local_key !== '_default') {
      paymentMethodByQboAccount[m.qbo_id] = m.local_key
    }
  }

  const accountTypeById: Record<string, string> = {}
  for (const account of accounts) accountTypeById[account.Id] = account.AccountType

  return {
    contacts,
    scheduledDisbursements: disbursements.flatMap((d) => {
      const award = awardById.get(d.grant_out_id)
      if (!award) return []
      const grantee = contactById.get(award.grantee_contact_id)
      return [
        {
          id: d.id,
          grant_out_id: d.grant_out_id,
          amount_cents: d.amount_cents,
          scheduled_date: d.scheduled_date,
          grantee_contact_id: award.grantee_contact_id,
          grantee_name: grantee?.display_name ?? '',
          grantee_qbo_vendor_id: grantee?.qbo_vendor_id ?? null,
          agreement_signed_date: award.agreement_signed_date,
        },
      ]
    }),
    unlinkedExpenses: unpushed
      .filter((e) => !awaitsBankPayment(e) && e.expense_date >= ninetyDaysAgo)
      .map(expenseCandidate),
    openInvoices: unpushed
      .filter((e) => awaitsBankPayment(e))
      .map((e) => ({ ...expenseCandidate(e), category_id: e.category_id })),
    committedPris: pris.flatMap((p) => {
      const recipient = contactById.get(p.recipient_contact_id)
      if (!recipient) return []
      return [
        {
          id: p.id,
          amount_cents: p.amount_cents,
          recipient_contact_id: p.recipient_contact_id,
          recipient_name: recipient.display_name,
          recipient_qbo_vendor_id: recipient.qbo_vendor_id,
        },
      ]
    }),
    categoryByQboAccount,
    paymentMethodByQboAccount,
    accountTypeById,
  }
}

function entityVersion(entity: Record<string, unknown>): string {
  if (typeof entity.SyncToken === 'string') return `st:${entity.SyncToken}`
  const meta = entity.MetaData as { LastUpdatedTime?: string } | undefined
  return `lu:${meta?.LastUpdatedTime ?? ''}`
}

async function processRecord(
  supabase: SupabaseClient<Database>,
  record: CdcRecord,
  ctx: MatchContext,
  echoIndex: EchoIndex,
  autoApplyEnabled: boolean,
  stats: PullStats
): Promise<void> {
  const { data: existing } = await supabase
    .from('qbo_inbox')
    .select('*')
    .eq('qbo_entity_type', record.entityType)
    .eq('qbo_entity_id', record.entity.Id)
    .maybeSingle()

  if (record.deleted) {
    if (!existing) return // deleted before we ever saw it
    if (existing.kind === 'deleted') return
    const wasActioned = existing.status === 'approved' || existing.status === 'auto_applied'
    await supabase
      .from('qbo_inbox')
      .update({
        kind: 'deleted',
        // Applied items need a human decision; unactioned ones just close out.
        status: wasActioned ? 'pending' : 'dismissed',
        ...(wasActioned
          ? {}
          : { dismiss_reason: 'Deleted in QuickBooks before it was reviewed.' }),
      })
      .eq('id', existing.id)
    stats.deleted += 1
    return
  }

  const normalized = normalizeEntity(record)
  const raw = record.entity as unknown as Json
  const echoExpenseId = findEchoExpenseId(record, normalized, echoIndex)

  if (!existing) {
    if (echoExpenseId) {
      await supabase.from('qbo_inbox').insert({
        ...inboxFields(normalized),
        raw,
        status: 'echo',
        expense_id: echoExpenseId,
      })
      stats.echoes += 1
      return
    }
    const suggestion = matchTransaction(normalized, ctx)
    const { data: inserted } = await supabase
      .from('qbo_inbox')
      .insert({
        ...inboxFields(normalized),
        raw,
        status: 'pending',
        suggestion: (suggestion as Json) ?? null,
      })
      .select('id')
      .single()
    stats.new += 1

    if (inserted && suggestion && autoApplyEnabled) {
      await maybeAutoApply(supabase, inserted.id, record, normalized, suggestion, stats)
    }
    return
  }

  const versionChanged = entityVersion(record.entity) !== entityVersion(asRecord(existing.raw))

  if (existing.status === 'pending') {
    // Refresh in place and re-match; an admin hasn't acted yet.
    const suggestion = matchTransaction(normalized, ctx)
    await supabase
      .from('qbo_inbox')
      .update({ ...inboxFields(normalized), raw, suggestion: (suggestion as Json) ?? null })
      .eq('id', existing.id)
    return
  }

  if (!versionChanged) return

  if (existing.status === 'dismissed') {
    // Edits to items we deliberately ignored stay ignored; keep raw current.
    await supabase.from('qbo_inbox').update({ ...inboxFields(normalized), raw }).eq('id', existing.id)
    return
  }

  // approved / auto_applied / echo. Only money-relevant edits (amount, date,
  // bank account) need a human look; payee/category/description edits —
  // including the app's own fill-in of matched transactions — just refresh.
  const material =
    normalized.amount_cents !== existing.amount_cents ||
    normalized.txn_date !== existing.txn_date ||
    normalized.qbo_payment_account_id !== existing.qbo_payment_account_id
  if (!material) {
    await supabase.from('qbo_inbox').update({ ...inboxFields(normalized), raw }).eq('id', existing.id)
    return
  }

  await supabase
    .from('qbo_inbox')
    .update({
      ...inboxFields(normalized),
      previous_raw: existing.raw,
      raw,
      kind: 'changed',
      status: 'pending',
      ...(existing.status === 'echo' && !existing.expense_id && echoExpenseId
        ? { expense_id: echoExpenseId }
        : {}),
    })
    .eq('id', existing.id)
  stats.changed += 1
}

async function rematchWaitingItem(
  supabase: SupabaseClient<Database>,
  item: QboInboxItem,
  ctx: MatchContext
): Promise<void> {
  const raw = asRecord(item.raw)
  if (typeof raw.Id !== 'string') return
  const normalized = normalizeEntity({
    entityType: item.qbo_entity_type as CdcRecord['entityType'],
    entity: raw as CdcRecord['entity'],
    deleted: false,
  })
  const suggestion = matchTransaction(normalized, ctx)
  // jsonb reorders keys, so compare canonically to avoid rewriting unchanged rows.
  if (canonical(suggestion ?? null) === canonical(item.suggestion ?? null)) return
  await supabase
    .from('qbo_inbox')
    .update({ suggestion: (suggestion as Json) ?? null })
    .eq('id', item.id)
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )
}

function findEchoExpenseId(
  record: CdcRecord,
  normalized: NormalizedTxn,
  echoIndex: EchoIndex
): string | null {
  if (record.entityType !== 'Purchase') return null
  const byId = echoIndex.byPurchaseId.get(record.entity.Id)
  if (byId) return byId
  return parseEchoMarker(normalized.qbo_private_note)
}

function inboxFields(normalized: NormalizedTxn) {
  return {
    qbo_entity_type: normalized.qbo_entity_type,
    qbo_entity_id: normalized.qbo_entity_id,
    txn_date: normalized.txn_date,
    amount_cents: normalized.amount_cents,
    direction: normalized.direction,
    counterparty_name: normalized.counterparty_name,
    qbo_payment_account_id: normalized.qbo_payment_account_id,
    qbo_line_account_ids: normalized.qbo_line_account_ids,
    qbo_doc_number: normalized.qbo_doc_number,
    qbo_private_note: normalized.qbo_private_note,
  }
}

async function maybeAutoApply(
  supabase: SupabaseClient<Database>,
  inboxId: string,
  record: CdcRecord,
  normalized: NormalizedTxn,
  suggestion: Suggestion,
  stats: PullStats
): Promise<void> {
  if (suggestion.type !== 'disbursement_paid' || !suggestion.auto_apply) return
  // Only a Purchase can stand in as the expense's QBO transaction.
  if (record.entityType !== 'Purchase') return

  try {
    const { expenseId } = await applyDisbursementPaid(supabase, {
      disbursementId: suggestion.disbursement_id,
      memberId: null,
      paidDate: normalized.txn_date ?? undefined,
      qboPurchaseId: record.entity.Id,
    })
    await supabase
      .from('qbo_inbox')
      .update({
        status: 'auto_applied',
        disbursement_id: suggestion.disbursement_id,
        expense_id: expenseId,
        reviewed_at: new Date().toISOString(),
        resolution: {
          action: 'disbursement_paid',
          auto: true,
          grant_out_id: suggestion.grant_out_id,
        } as Json,
      })
      .eq('id', inboxId)
    stats.auto_applied += 1
  } catch (error) {
    // Leave the row pending with its suggestion; an admin applies it manually.
    stats.errors.push(
      `auto-apply ${record.entityType} ${record.entity.Id}: ${error instanceof Error ? error.message : 'failed'}`
    )
  }
}

function asRecord(value: Json): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function finishRun(
  supabase: SupabaseClient<Database>,
  stats: PullStats,
  newCursor: string | null,
  error: string | null
): Promise<PullStats> {
  await supabase
    .from('qbo_sync_state')
    .update({
      last_run_at: new Date().toISOString(),
      last_run_status: error ? 'error' : 'ok',
      last_run_error: error ? error.slice(0, 1000) : null,
      last_run_stats: stats as unknown as Json,
      ...(newCursor ? { last_cdc_at: newCursor } : {}),
    })
    .eq('id', 1)
  if (error && !stats.errors.includes(error)) stats.errors.push(error)
  return stats
}
