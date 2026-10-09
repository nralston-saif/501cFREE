import type { QboInboxDirection, QboInboxEntityType } from '@/lib/supabase/types/database'
import type { QboRef, QboTxnLine } from './api'
import type { CdcRecord } from './cdc'

/**
 * Pure normalization of pulled QBO entities into the flat fields stored on
 * qbo_inbox rows. Everything here is defensive: QBO payload shapes vary
 * by entity and by how the transaction was entered (bank feed vs manual).
 */

export type NormalizedTxn = {
  qbo_entity_type: QboInboxEntityType
  qbo_entity_id: string
  txn_date: string | null
  amount_cents: number | null
  direction: QboInboxDirection | null
  counterparty_name: string | null
  qbo_payment_account_id: string | null
  qbo_line_account_ids: string[]
  qbo_doc_number: string | null
  qbo_private_note: string | null
  /** EntityRef (vendor/customer) id + payment type — used by the matcher, not persisted. */
  entity_ref_id: string | null
  payment_type: string | null
}

function toCents(amount: unknown): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  return Math.round(amount * 100)
}

function refValue(ref: unknown): string | null {
  if (ref && typeof ref === 'object' && 'value' in ref) {
    const value = (ref as QboRef).value
    return typeof value === 'string' ? value : null
  }
  return null
}

function refName(ref: unknown): string | null {
  if (ref && typeof ref === 'object' && 'name' in ref) {
    const name = (ref as QboRef).name
    return typeof name === 'string' && name.trim() !== '' ? name : null
  }
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function lines(entity: Record<string, unknown>): QboTxnLine[] {
  return Array.isArray(entity.Line) ? (entity.Line as QboTxnLine[]) : []
}

export function normalizeEntity(record: CdcRecord): NormalizedTxn {
  const e = record.entity
  const base: NormalizedTxn = {
    qbo_entity_type: record.entityType,
    qbo_entity_id: e.Id,
    txn_date: str(e.TxnDate),
    amount_cents: toCents(e.TotalAmt),
    direction: null,
    counterparty_name: null,
    qbo_payment_account_id: null,
    qbo_line_account_ids: [],
    qbo_doc_number: str(e.DocNumber),
    qbo_private_note: str(e.PrivateNote),
    entity_ref_id: null,
    payment_type: null,
  }

  switch (record.entityType) {
    case 'Purchase': {
      // Credit=true is a refund back onto the payment account.
      const isCredit = e.Credit === true
      const lineAccounts = lines(e)
        .map((l) => refValue(l.AccountBasedExpenseLineDetail?.AccountRef))
        .filter((v): v is string => v !== null)
      return {
        ...base,
        direction: isCredit ? 'money_in' : 'money_out',
        counterparty_name: refName(e.EntityRef),
        entity_ref_id: refValue(e.EntityRef),
        qbo_payment_account_id: refValue(e.AccountRef),
        qbo_line_account_ids: lineAccounts,
        payment_type: str(e.PaymentType),
      }
    }
    case 'Deposit': {
      const depositLines = lines(e)
      const lineAccounts = depositLines
        .map((l) => refValue(l.DepositLineDetail?.AccountRef))
        .filter((v): v is string => v !== null)
      // A single-line deposit has a meaningful payer; batched deposits don't.
      const soleEntity = depositLines.length === 1 ? depositLines[0].DepositLineDetail?.Entity : null
      return {
        ...base,
        direction: 'money_in',
        counterparty_name: refName(soleEntity),
        entity_ref_id: refValue(soleEntity),
        qbo_payment_account_id: refValue(e.DepositToAccountRef),
        qbo_line_account_ids: lineAccounts,
      }
    }
    case 'Transfer': {
      const from = refName(e.FromAccountRef)
      const to = refName(e.ToAccountRef)
      return {
        ...base,
        amount_cents: toCents(e.Amount),
        direction: 'money_out',
        counterparty_name: from || to ? `${from ?? '?'} → ${to ?? '?'}` : null,
        qbo_payment_account_id: refValue(e.FromAccountRef),
        qbo_line_account_ids: [refValue(e.ToAccountRef)].filter((v): v is string => v !== null),
      }
    }
    case 'JournalEntry': {
      // Amount = sum of debit lines (what was spent); a Gusto payroll JE debits
      // wage/tax expense accounts and credits the bank account.
      const journalLines = lines(e)
      let debitTotal = 0
      let sawDebit = false
      const debitAccounts: string[] = []
      let entityName: string | null = null
      let entityId: string | null = null
      for (const l of journalLines) {
        const detail = l.JournalEntryLineDetail
        if (!detail) continue
        if (detail.PostingType === 'Debit') {
          sawDebit = true
          if (typeof l.Amount === 'number') debitTotal += l.Amount
          const account = refValue(detail.AccountRef)
          if (account) debitAccounts.push(account)
          if (!entityName) entityName = refName(detail.Entity?.EntityRef)
          if (!entityId) entityId = refValue(detail.Entity?.EntityRef)
        }
      }
      return {
        ...base,
        amount_cents: sawDebit ? toCents(debitTotal) : base.amount_cents,
        direction: 'money_out',
        counterparty_name: entityName,
        entity_ref_id: entityId,
        qbo_line_account_ids: debitAccounts,
      }
    }
    default:
      return base
  }
}
