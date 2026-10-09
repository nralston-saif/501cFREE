import { describe, expect, it } from 'vitest'
import {
  dollarsToCents,
  normalizeInvoiceDate,
  parseInvoiceResult,
  stripCodeFence,
} from './normalize'

describe('dollarsToCents', () => {
  it('parses plain and formatted amounts into integer cents', () => {
    expect(dollarsToCents('1234.56')).toBe(123456)
    expect(dollarsToCents('$1,234.56')).toBe(123456)
    expect(dollarsToCents(' 89 ')).toBe(8900)
    expect(dollarsToCents(42)).toBe(4200)
  })

  it('rejects missing, non-numeric, and negative values', () => {
    expect(dollarsToCents(null)).toBeNull()
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('n/a')).toBeNull()
    expect(dollarsToCents('-5')).toBeNull()
  })
})

describe('normalizeInvoiceDate', () => {
  it('accepts a strict YYYY-MM-DD date', () => {
    expect(normalizeInvoiceDate('2026-06-16')).toBe('2026-06-16')
  })

  it('rejects other formats and impossible months/days', () => {
    expect(normalizeInvoiceDate('06/16/2026')).toBeNull()
    expect(normalizeInvoiceDate('2026-13-01')).toBeNull()
    expect(normalizeInvoiceDate('2026-06-40')).toBeNull()
    expect(normalizeInvoiceDate(null)).toBeNull()
  })
})

describe('stripCodeFence', () => {
  it('removes a ```json fence around the body', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })
})

describe('parseInvoiceResult', () => {
  it('maps a well-formed invoice', () => {
    const r = parseInvoiceResult({
      found: true,
      document_type: 'invoice',
      vendor_name: '  Northwind Advisory Group, LLC ',
      vendor_other_names: ['Riley Chen', '', 7],
      vendor_type: 'organization',
      total_amount: '$3,125.00',
      invoice_date: '2026-07-31',
      invoice_date_basis: 'billing_period',
      payment_date: null,
      due_date: null,
      service_period: 'July 2026',
      date_note: 'Invoice is for July 2026 with no date printed; used the last day of July.',
      description: 'Action plan review',
      category: 'Professional fees - other',
      likely_1099: true,
    })
    expect(r).toMatchObject({
      found: true,
      vendor_name: 'Northwind Advisory Group, LLC',
      vendor_other_names: ['Riley Chen'],
      vendor_type: 'organization',
      amount_cents: 312500,
      expense_date: '2026-07-31',
      invoice_date_basis: 'billing_period',
      service_period: 'July 2026',
      category_name: 'Professional fees - other',
      likely_1099: true,
      document_type: 'invoice',
    })
  })

  it('dates a receipt without an invoice date by its payment date', () => {
    const r = parseInvoiceResult({ document_type: 'receipt', payment_date: '2026-09-03' })
    expect(r.expense_date).toBe('2026-09-03')
    expect(r.invoice_date).toBeNull()
  })

  it('never uses the payment date as an invoice’s expense date', () => {
    const r = parseInvoiceResult({ document_type: 'invoice', payment_date: '2026-09-03' })
    expect(r.expense_date).toBeNull()
    expect(r.payment_date).toBe('2026-09-03')
  })

  it('defaults safely on garbage input', () => {
    const r = parseInvoiceResult(null)
    expect(r.found).toBe(false)
    expect(r.vendor_name).toBeNull()
    expect(r.amount_cents).toBeNull()
    expect(r.expense_date).toBeNull()
    expect(r.invoice_date_basis).toBe('unknown')
    expect(r.category_name).toBeNull()
    expect(r.likely_1099).toBe(false)
  })

  it('drops unknown categories and document types', () => {
    const r = parseInvoiceResult({ category: 'unknown', document_type: 'statement' })
    expect(r.category_name).toBeNull()
    expect(r.document_type).toBeNull()
  })
})
