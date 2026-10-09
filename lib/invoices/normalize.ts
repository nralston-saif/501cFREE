// Pure, import-free normalization of the raw invoice-extraction JSON returned by
// Claude into the shape the expense form consumes. Kept dependency-free so it is
// unit-testable without the SDK or the Next runtime.

export type InvoiceDateBasis = 'stated' | 'billing_period' | 'inferred' | 'unknown'

export interface ExtractedInvoice {
  found: boolean
  vendor_name: string | null
  /** Other names the payee goes by (e.g. the person behind an LLC). */
  vendor_other_names: string[]
  vendor_type: 'organization' | 'individual'
  amount_cents: number | null
  /** The expense date: invoice date, or payment date for a receipt without one. YYYY-MM-DD */
  expense_date: string | null
  invoice_date: string | null
  invoice_date_basis: InvoiceDateBasis
  payment_date: string | null
  due_date: string | null
  service_period: string | null
  /** Short explanation shown when a date was inferred rather than printed. */
  date_note: string | null
  description: string | null
  /** A category name from the list Claude was given, or null. */
  category_name: string | null
  likely_1099: boolean
  /** 'receipt' = proof of a payment already made; 'invoice' = a bill to pay. */
  document_type: 'invoice' | 'receipt' | null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** "$1,234.56" / "1234.56" -> 123456 cents. Null for missing/invalid/negative. */
export function dollarsToCents(value: unknown): number | null {
  const str = typeof value === 'number' ? String(value) : asString(value)
  if (str === null) return null
  const cleaned = str.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num < 0) return null
  return Math.round(num * 100)
}

/** Accept only a strict YYYY-MM-DD calendar date; otherwise null. */
export function normalizeInvoiceDate(value: unknown): string | null {
  const str = asString(value)
  if (str === null) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
  if (!match) return null
  const [, y, m, d] = match
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${m}-${d}`
}

/** Strip an accidental ```json ... ``` fence so JSON.parse can read the body. */
export function stripCodeFence(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/** Map Claude's raw object into a clean ExtractedInvoice (never throws). */
export function parseInvoiceResult(raw: unknown): ExtractedInvoice {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const description = asString(obj.description)
  const invoiceDate = normalizeInvoiceDate(obj.invoice_date)
  const paymentDate = normalizeInvoiceDate(obj.payment_date)
  const basis = obj.invoice_date_basis
  const documentType =
    obj.document_type === 'invoice' || obj.document_type === 'receipt' ? obj.document_type : null
  const category = asString(obj.category)
  return {
    found: obj.found === true,
    vendor_name: asString(obj.vendor_name),
    vendor_other_names: Array.isArray(obj.vendor_other_names)
      ? obj.vendor_other_names.map(asString).filter((n): n is string => n !== null).slice(0, 5)
      : [],
    vendor_type: obj.vendor_type === 'individual' ? 'individual' : 'organization',
    amount_cents: dollarsToCents(obj.total_amount),
    // A receipt without a printed invoice date is dated by its payment.
    expense_date: invoiceDate ?? (documentType === 'receipt' ? paymentDate : null),
    invoice_date: invoiceDate,
    invoice_date_basis:
      basis === 'stated' || basis === 'billing_period' || basis === 'inferred' ? basis : 'unknown',
    payment_date: paymentDate,
    due_date: normalizeInvoiceDate(obj.due_date),
    service_period: asString(obj.service_period)?.slice(0, 80) ?? null,
    date_note: asString(obj.date_note)?.slice(0, 200) ?? null,
    description: description ? description.slice(0, 200) : null,
    category_name: category && category !== 'unknown' ? category : null,
    likely_1099: obj.likely_1099 === true,
    document_type: documentType,
  }
}
