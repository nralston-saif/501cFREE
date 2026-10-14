import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import mammoth from 'mammoth'
import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import { requireMemberId } from '@/lib/actions/helpers'
import {
  extractInvoiceFields,
  isInvoiceExtractionEnabled,
  type InvoiceSource,
} from '@/lib/invoices/extract'
import { findVendorByNames, namesOf } from '@/lib/invoices/vendor-groups'
import { checkInvoiceFile, INVOICE_UPLOAD_PREFIX } from '@/lib/invoices/formats'
import { getOrgSettings } from '@/lib/settings'
import { demoAiDelay, isScriptedAi } from '@/lib/ai/demo'
import { scriptedInvoiceExtraction } from '@/lib/ai/demo-scripts'
import { todayInTimeZone } from '@/lib/utils/dates'
import type { ExtractedInvoice } from '@/lib/invoices/normalize'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Claude's image limit; larger photos fall back to manual entry.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Read an invoice or receipt the browser already uploaded to the documents
 * bucket under expense-import/ (bulk upload: PDF, .docx, images) and return
 * pre-fill fields for its expense row. Body: `{ storage_path }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireMemberId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isInvoiceExtractionEnabled()) {
    return NextResponse.json({ enabled: false, extracted: null })
  }

  const supabase = await createClient()

  const body = (await request.json().catch(() => null)) as { storage_path?: unknown } | null
  const path = typeof body?.storage_path === 'string' ? body.storage_path : ''
  if (!path.startsWith(INVOICE_UPLOAD_PREFIX) || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
  }
  const { data: blob, error } = await supabase.storage.from('documents').download(path)
  if (error || !blob) {
    return NextResponse.json({ error: 'Uploaded file not found' }, { status: 404 })
  }
  const check = checkInvoiceFile(path, blob.size)
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 })
  const bytes = Buffer.from(await blob.arrayBuffer())
  const duplicateOf = await findAttachedCopy(supabase, path, bytes)
  // Demo mode without a key: a scripted reading, so no file content is needed
  const scripted = isScriptedAi()
  const source = scripted ? null : await sourceFor(check.kind, check.mime, bytes)

  if (!source && !scripted) return NextResponse.json({ enabled: true, extracted: null, duplicate_of: duplicateOf })

  const [{ data: categories }, vendors, settings] = await Promise.all([
    supabase
      .from('expense_categories')
      .select('id, name, form_990_line, functional_class')
      .eq('is_active', true)
      .order('name'),
    loadContactOptions(supabase, { vendorsOnly: true }),
    getOrgSettings(supabase),
  ])

  let extracted: ExtractedInvoice | null
  if (scripted) {
    // The original file name follows the upload's uuid prefix
    const fileName = path.slice(INVOICE_UPLOAD_PREFIX.length).replace(/^[0-9a-f-]{36}-/i, '')
    await demoAiDelay(fileName)
    extracted = scriptedInvoiceExtraction(
      fileName,
      (categories ?? []).map((c) => c.name),
      todayInTimeZone(settings.timezone)
    )
  } else {
    extracted = await extractInvoiceFields(source!, categories ?? [], settings)
  }
  if (!extracted) {
    return NextResponse.json({ enabled: true, extracted: null, duplicate_of: duplicateOf })
  }

  // Match any of the payee's names to an existing vendor, ignoring case,
  // punctuation and suffixes like LLC / Inc.
  const vendor = findVendorByNames(namesOf(extracted), vendors)

  // Category: what this vendor's past expenses used, else Claude's pick.
  let categoryId: string | null = null
  let categorySource: 'vendor_history' | 'claude' | null = null
  if (vendor) {
    const { data: past } = await supabase
      .from('expenses')
      .select('category_id')
      .eq('vendor_contact_id', vendor.id)
    const counts = new Map<string, number>()
    for (const e of past ?? []) counts.set(e.category_id, (counts.get(e.category_id) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (top && (categories ?? []).some((c) => c.id === top)) {
      categoryId = top
      categorySource = 'vendor_history'
    }
  }
  if (!categoryId && extracted.category_name) {
    categoryId = (categories ?? []).find((c) => c.name === extracted.category_name)?.id ?? null
    if (categoryId) categorySource = 'claude'
  }

  return NextResponse.json({
    enabled: true,
    demo: scripted,
    extracted: {
      ...extracted,
      vendor_contact_id: vendor?.id ?? null,
      category_id: categoryId,
      category_source: categorySource,
    },
    duplicate_of: duplicateOf,
  })
}

/**
 * The expense this exact file (byte for byte) is already attached to, if
 * any. Only same-size attachments are downloaded and hashed, so this is
 * cheap; a file can be identical only if its size matches.
 */
async function findAttachedCopy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string,
  bytes: Buffer
): Promise<{ expense_id: string; description: string; file_name: string } | null> {
  const { data: sameSize } = await supabase
    .from('attachments')
    .select('entity_id, storage_path, file_name')
    .eq('entity_type', 'expense')
    .eq('size_bytes', bytes.length)
    .neq('storage_path', path)
  if (!sameSize || sameSize.length === 0) return null

  const digest = createHash('sha256').update(bytes).digest('hex')
  for (const candidate of sameSize.slice(0, 10)) {
    const { data: other } = await supabase.storage.from('documents').download(candidate.storage_path)
    if (!other) continue
    const otherDigest = createHash('sha256').update(Buffer.from(await other.arrayBuffer())).digest('hex')
    if (otherDigest !== digest) continue
    const { data: expense } = await supabase
      .from('expenses')
      .select('id, description')
      .eq('id', candidate.entity_id)
      .maybeSingle()
    if (expense) return { expense_id: expense.id, description: expense.description, file_name: candidate.file_name }
  }
  return null
}

async function sourceFor(
  kind: 'pdf' | 'docx' | 'image',
  mime: string,
  bytes: Buffer
): Promise<InvoiceSource | null> {
  if (kind === 'pdf') return { kind: 'pdf', base64: bytes.toString('base64') }
  if (kind === 'image') {
    if (bytes.length > MAX_IMAGE_BYTES) return null
    return {
      kind: 'image',
      base64: bytes.toString('base64'),
      mediaType: mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
    }
  }
  try {
    const { value } = await mammoth.extractRawText({ buffer: bytes })
    return value.trim() ? { kind: 'text', text: value } : null
  } catch {
    return null
  }
}
