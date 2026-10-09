import { describe, expect, it } from 'vitest'
import {
  matchTransaction,
  normalizeName,
  type MatchContext,
  type OpenInvoiceCandidate,
  type Suggestion,
} from './match'
import type { NormalizedTxn } from './normalize'

function txn(overrides: Partial<NormalizedTxn>): NormalizedTxn {
  return {
    qbo_entity_type: 'Purchase',
    qbo_entity_id: '1',
    txn_date: '2026-08-05',
    amount_cents: 500000,
    direction: 'money_out',
    counterparty_name: null,
    qbo_payment_account_id: null,
    qbo_line_account_ids: [],
    qbo_doc_number: null,
    qbo_private_note: null,
    entity_ref_id: null,
    payment_type: null,
    ...overrides,
  }
}

function ctx(overrides: Partial<MatchContext>): MatchContext {
  return {
    scheduledDisbursements: [],
    unlinkedExpenses: [],
    openInvoices: [],
    committedPris: [],
    contacts: [],
    categoryByQboAccount: {},
    paymentMethodByQboAccount: {},
    accountTypeById: {},
    ...overrides,
  }
}

const arcDisbursement = {
  id: 'disb-1',
  grant_out_id: 'award-1',
  amount_cents: 500000,
  scheduled_date: '2026-08-04',
  grantee_contact_id: 'contact-1',
  grantee_name: 'Harbor Institute',
  grantee_qbo_vendor_id: '56',
  agreement_signed_date: '2026-07-15',
}

describe('normalizeName', () => {
  it('strips punctuation and org suffixes', () => {
    expect(normalizeName('The Harbor Institute, Inc.')).toBe('harbor institute')
    expect(normalizeName('HARBOR   institute LLC')).toBe('harbor institute')
  })
})

describe('matchTransaction — money out', () => {
  it('auto-applies an exact disbursement match (amount + verified payee + signed agreement)', () => {
    const s = matchTransaction(
      txn({ entity_ref_id: '56' }),
      ctx({ scheduledDisbursements: [arcDisbursement] })
    )
    expect(s).toMatchObject({ type: 'disbursement_paid', disbursement_id: 'disb-1', auto_apply: true })
  })

  it('verifies the payee by normalized name when there is no vendor id', () => {
    const s = matchTransaction(
      txn({ counterparty_name: 'HARBOR INSTITUTE INC' }),
      ctx({ scheduledDisbursements: [{ ...arcDisbursement, grantee_qbo_vendor_id: null }] })
    )
    expect(s).toMatchObject({ type: 'disbursement_paid', auto_apply: true })
  })

  it('downgrades to a suggestion when the payee cannot be verified', () => {
    const s = matchTransaction(txn({}), ctx({ scheduledDisbursements: [arcDisbursement] }))
    expect(s).toMatchObject({ type: 'disbursement_paid', auto_apply: false })
    expect((s as { reason: string }).reason).toContain('payee')
  })

  it('downgrades when the award has no signed agreement', () => {
    const s = matchTransaction(
      txn({ entity_ref_id: '56' }),
      ctx({
        scheduledDisbursements: [{ ...arcDisbursement, agreement_signed_date: null }],
      })
    )
    expect(s).toMatchObject({ type: 'disbursement_paid', auto_apply: false })
    expect((s as { reason: string }).reason).toContain('agreement')
  })

  it('downgrades on ambiguity and picks the nearest scheduled date', () => {
    const other = {
      ...arcDisbursement,
      id: 'disb-2',
      scheduled_date: '2026-09-30',
    }
    const s = matchTransaction(
      txn({ entity_ref_id: '56' }),
      ctx({ scheduledDisbursements: [other, arcDisbursement] })
    )
    expect(s).toMatchObject({ type: 'disbursement_paid', disbursement_id: 'disb-1', auto_apply: false })
  })

  it('links an existing expense with same amount, close date, and payee', () => {
    const s = matchTransaction(
      txn({ amount_cents: 12000, entity_ref_id: '90' }),
      ctx({
        unlinkedExpenses: [
          {
            id: 'exp-1',
            amount_cents: 12000,
            expense_date: '2026-08-03',
            description: 'Contractor invoice #12',
            vendor_contact_id: 'c-9',
            vendor_name: 'Jane Contractor',
            vendor_qbo_vendor_id: '90',
          },
        ],
      })
    )
    expect(s).toMatchObject({ type: 'link_expense', expense_id: 'exp-1' })
  })

  it('does not link an expense outside the ±3 day window', () => {
    const s = matchTransaction(
      txn({ amount_cents: 12000, entity_ref_id: '90' }),
      ctx({
        unlinkedExpenses: [
          {
            id: 'exp-1',
            amount_cents: 12000,
            expense_date: '2026-07-20',
            description: 'Old invoice',
            vendor_contact_id: 'c-9',
            vendor_name: 'Jane Contractor',
            vendor_qbo_vendor_id: '90',
          },
        ],
      })
    )
    expect(s?.type).toBe('new_expense')
  })

  it('suggests PRI funding but never auto-applies it', () => {
    const s = matchTransaction(
      txn({ amount_cents: 25000000, counterparty_name: 'Northwind Labs, Inc.' }),
      ctx({
        committedPris: [
          {
            id: 'pri-1',
            amount_cents: 25000000,
            recipient_contact_id: 'c-2',
            recipient_name: 'Northwind Labs',
            recipient_qbo_vendor_id: null,
          },
        ],
      })
    )
    expect(s).toMatchObject({ type: 'fund_pri', pri_id: 'pri-1' })
  })

  it('falls back to a prefilled new expense using inverted mappings', () => {
    const s = matchTransaction(
      txn({
        qbo_line_account_ids: ['82'],
        qbo_payment_account_id: '35',
        counterparty_name: 'Acme Software',
        entity_ref_id: '56',
        qbo_private_note: 'Monthly SaaS',
      }),
      ctx({
        categoryByQboAccount: { '82': 'cat-software' },
        paymentMethodByQboAccount: { '35': 'ach' },
        contacts: [{ id: 'c-5', display_name: 'Acme Software', qbo_vendor_id: '56' }],
      })
    )
    expect(s).toMatchObject({
      type: 'new_expense',
      prefill: {
        category_id: 'cat-software',
        payment_method: 'ach',
        vendor_contact_id: 'c-5',
        description: 'Monthly SaaS',
        amount_cents: 500000,
      },
    })
  })

  it('prefers Purchase.PaymentType over the account mapping for card', () => {
    const s = matchTransaction(
      txn({ payment_type: 'CreditCard', qbo_payment_account_id: '35' }),
      ctx({ paymentMethodByQboAccount: { '35': 'ach' } })
    )
    expect(s).toMatchObject({ type: 'new_expense', prefill: { payment_method: 'card' } })
  })
})

function invoice(overrides: Partial<OpenInvoiceCandidate>): OpenInvoiceCandidate {
  return {
    id: 'inv-1',
    amount_cents: 175830,
    expense_date: '2026-07-10',
    description: 'A&P Legal Services — June',
    vendor_contact_id: 'c-ap',
    vendor_name: 'Contoso Legal Partners LLP',
    vendor_qbo_vendor_id: '77',
    category_id: 'cat-legal',
    ...overrides,
  }
}

function payInvoice(s: Suggestion | null) {
  if (s?.type !== 'pay_invoice') throw new Error(`expected pay_invoice, got ${s?.type}`)
  return s
}

describe('matchTransaction — paying open invoices', () => {
  const payment = (overrides: Partial<NormalizedTxn> = {}) =>
    txn({ amount_cents: 175830, txn_date: '2026-08-05', entity_ref_id: '77', ...overrides })

  it('is confident with one invoice of the same amount and vendor', () => {
    const s = payInvoice(matchTransaction(payment(), ctx({ openInvoices: [invoice({})] })))
    expect(s.confident).toBe(true)
    expect(s.candidates).toEqual([
      expect.objectContaining({ expense_id: 'inv-1', vendor_verified: true, category_note: null }),
    ])
  })

  it('verifies the vendor by normalized name when QBO has no vendor id', () => {
    const s = payInvoice(
      matchTransaction(
        payment({ entity_ref_id: null, counterparty_name: 'Contoso Legal Partners, LLP' }),
        ctx({ openInvoices: [invoice({ vendor_qbo_vendor_id: null })] })
      )
    )
    expect(s.confident).toBe(true)
  })

  it('needs a look when the payee does not match the invoice vendor', () => {
    const s = payInvoice(
      matchTransaction(
        payment({ entity_ref_id: '99', counterparty_name: 'Someone Else' }),
        ctx({ openInvoices: [invoice({})] })
      )
    )
    expect(s.confident).toBe(false)
    expect(s.candidates[0].vendor_verified).toBe(false)
    expect(s.reason).toContain('Someone Else')
  })

  it('needs a look when several invoices from the vendor share the amount', () => {
    const s = payInvoice(
      matchTransaction(
        payment(),
        ctx({
          openInvoices: [
            invoice({ id: 'inv-old', expense_date: '2026-06-01' }),
            invoice({ id: 'inv-new', expense_date: '2026-07-28' }),
          ],
        })
      )
    )
    expect(s.confident).toBe(false)
    // Closest invoice date first.
    expect(s.candidates.map((c) => c.expense_id)).toEqual(['inv-new', 'inv-old'])
  })

  it('ranks the verified vendor above an unverified one and stays confident', () => {
    const s = payInvoice(
      matchTransaction(
        payment(),
        ctx({
          openInvoices: [
            invoice({
              id: 'inv-other',
              expense_date: '2026-08-04',
              vendor_name: 'Other Vendor',
              vendor_qbo_vendor_id: '12',
            }),
            invoice({ id: 'inv-ap' }),
          ],
        })
      )
    )
    expect(s.confident).toBe(true)
    expect(s.candidates.map((c) => c.expense_id)).toEqual(['inv-ap', 'inv-other'])
  })

  it('ignores invoices with a different amount or outside the payment window', () => {
    const s = matchTransaction(
      payment(),
      ctx({
        openInvoices: [
          invoice({ id: 'wrong-amount', amount_cents: 175831 }),
          invoice({ id: 'too-old', expense_date: '2026-01-01' }),
          invoice({ id: 'too-far-ahead', expense_date: '2026-08-20' }),
        ],
      })
    )
    expect(s?.type).toBe('new_expense')
  })

  it('accepts a payment made a few days before the invoice date', () => {
    const s = matchTransaction(
      payment({ txn_date: '2026-07-05' }),
      ctx({ openInvoices: [invoice({})] })
    )
    expect(s?.type).toBe('pay_invoice')
  })

  it('flags a QBO category that differs from the invoice', () => {
    const s = payInvoice(
      matchTransaction(
        payment({ qbo_line_account_ids: ['54'] }),
        ctx({
          openInvoices: [invoice({})],
          categoryByQboAccount: { '54': 'cat-software' },
        })
      )
    )
    expect(s.candidates[0].category_note).not.toBeNull()
    // The "not this invoice" fallback carries QBO's own categorization.
    expect(s.prefill).toMatchObject({ category_id: 'cat-software', amount_cents: 175830 })
  })

  it('lets a scheduled grant disbursement win over an invoice of the same amount', () => {
    const s = matchTransaction(
      txn({ entity_ref_id: '56' }),
      ctx({
        scheduledDisbursements: [arcDisbursement],
        openInvoices: [invoice({ amount_cents: 500000, vendor_qbo_vendor_id: '56' })],
      })
    )
    expect(s?.type).toBe('disbursement_paid')
  })
})

describe('matchTransaction — money in', () => {
  it('suggests a contribution for a single-line income deposit with a known donor', () => {
    const s = matchTransaction(
      txn({
        qbo_entity_type: 'Deposit',
        direction: 'money_in',
        amount_cents: 1000000,
        counterparty_name: 'Jane Donor',
        qbo_line_account_ids: ['91'],
      }),
      ctx({
        accountTypeById: { '91': 'Income' },
        contacts: [{ id: 'c-7', display_name: 'Jane Donor', qbo_vendor_id: null }],
      })
    )
    expect(s).toMatchObject({
      type: 'new_contribution',
      prefill: { contact_id: 'c-7', amount_cents: 1000000, received_date: '2026-08-05' },
    })
  })

  it('still suggests a contribution when the donor is unknown', () => {
    const s = matchTransaction(
      txn({
        qbo_entity_type: 'Deposit',
        direction: 'money_in',
        counterparty_name: 'New Donor Fund',
        qbo_line_account_ids: ['91'],
      }),
      ctx({ accountTypeById: { '91': 'Income' } })
    )
    expect(s).toMatchObject({ type: 'new_contribution', prefill: { contact_id: null } })
  })

  it('suggests dismissing a vendor refund (Purchase credit)', () => {
    const s = matchTransaction(
      txn({ qbo_entity_type: 'Purchase', direction: 'money_in' }),
      ctx({})
    )
    expect(s).toMatchObject({ type: 'dismiss' })
    expect((s as { reason: string }).reason).toContain('refund')
  })

  it('suggests dismissing non-donation income', () => {
    const s = matchTransaction(
      txn({
        qbo_entity_type: 'Deposit',
        direction: 'money_in',
        qbo_line_account_ids: ['95'],
      }),
      ctx({ accountTypeById: { '95': 'Other Current Asset' } })
    )
    expect(s).toMatchObject({ type: 'dismiss' })
  })
})

describe('matchTransaction — transfers', () => {
  it('suggests dismissing internal transfers', () => {
    const s = matchTransaction(txn({ qbo_entity_type: 'Transfer' }), ctx({}))
    expect(s).toMatchObject({ type: 'dismiss' })
    expect((s as { reason: string }).reason).toContain('transfer')
  })
})
