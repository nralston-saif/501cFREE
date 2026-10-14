import Anthropic from '@anthropic-ai/sdk'
import { parseInvoiceResult, type ExtractedInvoice } from './normalize'
import { EXTRACTION_MODEL, FALLBACK_MODEL } from '@/lib/ai/models'
import { isAiAvailable } from '@/lib/ai/demo'
import type { OrgSettings } from '@/lib/supabase/types/database'

// A strong model: the dates and category need judgment (month-only invoices,
// receipts vs bills, picking the right 990 line), not just transcription.

/** The organization whose books the invoice goes into (from org settings) */
export type InvoiceBuyer = Pick<
  OrgSettings,
  'org_legal_name' | 'org_display_name' | 'org_aliases' | 'country'
>

export type InvoiceCategoryOption = { name: string; form_990_line: string | null; functional_class: string }

export type InvoiceSource =
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }
  | { kind: 'text'; text: string }

/**
 * A key, or demo mode's scripted provider (lib/ai/demo.ts). The scripted
 * path doesn't read the file; the extract route calls
 * scriptedInvoiceExtraction() in place of extractInvoiceFields().
 */
export function isInvoiceExtractionEnabled(): boolean {
  return isAiAvailable()
}

const nullableString = { type: ['string', 'null'] } as const

function outputSchema(categoryNames: string[]) {
  return {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      document_type: { type: 'string', enum: ['invoice', 'receipt', 'other'] },
      vendor_name: nullableString,
      vendor_other_names: { type: 'array', items: { type: 'string' } },
      vendor_type: { type: 'string', enum: ['organization', 'individual'] },
      total_amount: nullableString,
      invoice_date: nullableString,
      invoice_date_basis: { type: 'string', enum: ['stated', 'billing_period', 'inferred', 'unknown'] },
      payment_date: nullableString,
      due_date: nullableString,
      service_period: nullableString,
      date_note: nullableString,
      description: nullableString,
      category: { type: 'string', enum: [...categoryNames, 'unknown'] },
      likely_1099: { type: 'boolean' },
    },
    required: [
      'found',
      'document_type',
      'vendor_name',
      'vendor_other_names',
      'vendor_type',
      'total_amount',
      'invoice_date',
      'invoice_date_basis',
      'payment_date',
      'due_date',
      'service_period',
      'date_note',
      'description',
      'category',
      'likely_1099',
    ],
    additionalProperties: false,
  }
}

/** "Acme Foundation Inc. (also written Acme Fdn / Acme)", or a neutral fallback */
export function describeBuyer(buyer: InvoiceBuyer): string {
  const names = [buyer.org_legal_name, buyer.org_display_name, ...buyer.org_aliases]
    .map((n) => n?.trim())
    .filter((n): n is string => Boolean(n))
  const unique = [...new Set(names)]
  if (unique.length === 0) return 'our organization'
  const [primary, ...others] = unique
  return others.length > 0 ? `${primary} (also written ${others.join(' / ')})` : primary
}

export function buildInvoicePrompt(categories: InvoiceCategoryOption[], buyer: InvoiceBuyer): string {
  const categoryLines = categories
    .map((c) => `- ${c.name} (${c.functional_class.replace('_', ' & ')}${c.form_990_line ? `, Form 990 ${c.form_990_line}` : ''})`)
    .join('\n')
  const nonprofit = buyer.country === 'US' ? 'a US 501(c)(3) nonprofit' : 'a nonprofit'
  return `You are filing a vendor invoice or receipt into the books of ${describeBuyer(buyer)}, ${nonprofit}. That organization is always the customer (the buyer), never the vendor; if one of its names appears on the document, it is the bill-to party.

Read the document and fill in the fields. Bookkeeping depends on getting the dates right, so think about which date is which:
- invoice_date: the date the bill was issued (YYYY-MM-DD). If one is printed, use it and set invoice_date_basis "stated". If the document only names a billing month or service period (e.g. "Invoice – July 2026"), use the last day of that period and set "billing_period". If you can only infer it from other clues, set "inferred". If there's nothing to go on, null and "unknown". Never guess today's date.
- payment_date: only when the document shows the money was already paid (a receipt, "PAID" stamp, payment confirmation, card charge). Otherwise null. This is different from the invoice date.
- due_date: the payment due date if printed, else null.
- service_period: the period the work covers, in short words ("July 2026", "Q3 2026"), or null.
- date_note: one short sentence for the bookkeeper whenever invoice_date was not printed outright (say what you used and why), else null.

Other fields:
- found: true if this is an invoice, bill, or receipt.
- document_type: "receipt" if it shows a payment already made, "invoice" if it asks to be paid, "other" otherwise.
- vendor_name: who is being paid. Prefer the legal business name when there is one (e.g. "Northwind Consulting, LLC"). vendor_other_names: other names for the same payee on the document, such as the individual behind the business. Spell names exactly as printed. vendor_type: "organization" for a business (including a one-person LLC billing as the business), "individual" for a person billing in their own name.
- total_amount: the total due or paid, as a plain number with no symbols or separators, e.g. "1234.56".
- description: what was bought, in at most ~80 characters.
- category: the best match from the organization's expense categories below, or "unknown" if none fits:
${categoryLines}
- likely_1099: true when this pays for services to an individual or an unincorporated business such as an LLC or sole proprietor (not a corporation, and not goods). Payments to law firms for legal services also count.`
}

/**
 * Ask Claude to read an invoice or receipt (PDF, image, or the text of a Word
 * document) and return normalized expense fields, including which category
 * from `categories` fits. Returns null when extraction is unavailable (no key)
 * or fails — callers fall back to manual entry. Never throws.
 */
export async function extractInvoiceFields(
  source: InvoiceSource,
  categories: InvoiceCategoryOption[],
  buyer: InvoiceBuyer
): Promise<ExtractedInvoice | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const documentBlock: Anthropic.Beta.BetaContentBlockParam =
    source.kind === 'pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: source.base64 },
        }
      : source.kind === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.base64 } }
        : { type: 'text', text: `<document>\n${source.text}\n</document>` }

  try {
    const client = new Anthropic()
    const response = await client.beta.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: outputSchema(categories.map((c) => c.name)) },
      },
      // If the model declines, retry the same request on the fallback model.
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: FALLBACK_MODEL }],
      messages: [{ role: 'user', content: [documentBlock, { type: 'text', text: buildInvoicePrompt(categories, buyer) }] }],
    })
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return null
    return parseInvoiceResult(JSON.parse(textBlock.text))
  } catch {
    return null
  }
}
