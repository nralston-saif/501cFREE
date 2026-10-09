import { describe, expect, it } from 'vitest'
import { normalizeEntity } from './normalize'
import type { CdcRecord } from './cdc'

function record(entityType: CdcRecord['entityType'], entity: Record<string, unknown>): CdcRecord {
  return { entityType, entity: { Id: 'X', ...entity } as CdcRecord['entity'], deleted: false }
}

describe('normalizeEntity', () => {
  it('normalizes a bank-feed Purchase', () => {
    const txn = normalizeEntity(
      record('Purchase', {
        Id: '145',
        TxnDate: '2026-08-01',
        TotalAmt: 1234.56,
        PaymentType: 'CreditCard',
        AccountRef: { value: '35', name: 'Checking' },
        EntityRef: { value: '56', name: 'Acme Software Inc.', type: 'Vendor' },
        PrivateNote: 'Monthly SaaS',
        Line: [
          {
            Amount: 1234.56,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: { AccountRef: { value: '82', name: 'Software' } },
          },
        ],
      })
    )
    expect(txn).toMatchObject({
      qbo_entity_type: 'Purchase',
      qbo_entity_id: '145',
      txn_date: '2026-08-01',
      amount_cents: 123456,
      direction: 'money_out',
      counterparty_name: 'Acme Software Inc.',
      entity_ref_id: '56',
      qbo_payment_account_id: '35',
      qbo_line_account_ids: ['82'],
      qbo_private_note: 'Monthly SaaS',
      payment_type: 'CreditCard',
    })
  })

  it('treats a Purchase credit as money in (vendor refund)', () => {
    const txn = normalizeEntity(
      record('Purchase', { TotalAmt: 50, Credit: true, AccountRef: { value: '35' } })
    )
    expect(txn.direction).toBe('money_in')
    expect(txn.amount_cents).toBe(5000)
  })

  it('normalizes a single-line Deposit with its payer', () => {
    const txn = normalizeEntity(
      record('Deposit', {
        Id: '201',
        TxnDate: '2026-08-03',
        TotalAmt: 10000,
        DepositToAccountRef: { value: '35', name: 'Checking' },
        Line: [
          {
            Amount: 10000,
            DetailType: 'DepositLineDetail',
            DepositLineDetail: {
              AccountRef: { value: '91', name: 'Contributions' },
              Entity: { value: '77', name: 'Jane Donor' },
            },
          },
        ],
      })
    )
    expect(txn).toMatchObject({
      direction: 'money_in',
      amount_cents: 1000000,
      counterparty_name: 'Jane Donor',
      entity_ref_id: '77',
      qbo_payment_account_id: '35',
      qbo_line_account_ids: ['91'],
    })
  })

  it('leaves the payer blank on a batched (multi-line) Deposit', () => {
    const txn = normalizeEntity(
      record('Deposit', {
        TotalAmt: 300,
        Line: [
          { DepositLineDetail: { AccountRef: { value: '91' }, Entity: { value: '1', name: 'A' } } },
          { DepositLineDetail: { AccountRef: { value: '91' }, Entity: { value: '2', name: 'B' } } },
        ],
      })
    )
    expect(txn.counterparty_name).toBeNull()
    expect(txn.qbo_line_account_ids).toEqual(['91', '91'])
  })

  it('normalizes a Transfer with both account names', () => {
    const txn = normalizeEntity(
      record('Transfer', {
        TxnDate: '2026-08-02',
        Amount: 2500,
        FromAccountRef: { value: '35', name: 'Checking' },
        ToAccountRef: { value: '36', name: 'Savings' },
      })
    )
    expect(txn).toMatchObject({
      amount_cents: 250000,
      direction: 'money_out',
      counterparty_name: 'Checking → Savings',
      qbo_payment_account_id: '35',
    })
  })

  it('sums debit lines of a JournalEntry (Gusto-style payroll)', () => {
    const txn = normalizeEntity(
      record('JournalEntry', {
        TxnDate: '2026-08-15',
        Line: [
          {
            Amount: 8000,
            JournalEntryLineDetail: {
              PostingType: 'Debit',
              AccountRef: { value: '60', name: 'Salaries' },
            },
          },
          {
            Amount: 612.4,
            JournalEntryLineDetail: {
              PostingType: 'Debit',
              AccountRef: { value: '61', name: 'Payroll taxes' },
            },
          },
          {
            Amount: 8612.4,
            JournalEntryLineDetail: {
              PostingType: 'Credit',
              AccountRef: { value: '35', name: 'Checking' },
            },
          },
        ],
      })
    )
    expect(txn.amount_cents).toBe(861240)
    expect(txn.direction).toBe('money_out')
    expect(txn.qbo_line_account_ids).toEqual(['60', '61'])
  })

  it('survives an entity with nothing but an Id', () => {
    const txn = normalizeEntity(record('Purchase', {}))
    expect(txn.qbo_entity_id).toBe('X')
    expect(txn.amount_cents).toBeNull()
    expect(txn.txn_date).toBeNull()
  })
})
