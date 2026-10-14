'use client'

import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import VendorSelect from '@/components/VendorSelect'
import DemoAiBadge from '@/components/DemoAiBadge'
import MoneyInput from '@/components/MoneyInput'
import { withBasePath } from '@/lib/basePath'
import {
  createExpenseFromUpload,
  createInvoiceUploadUrl,
  createVendorForUpload,
  discardInvoiceUpload,
  stageInvoiceFile,
} from '@/lib/actions/invoice-uploads'
import { parseContactKind } from '@/lib/contacts/names'
import {
  checkInvoiceFile,
  INVOICE_ACCEPT_ATTR,
  INVOICE_ACCEPTED_LABEL,
} from '@/lib/invoices/formats'
import { groupNewVendors, type NewVendorGroup } from '@/lib/invoices/vendor-groups'
import { centsToDollarString, formatCents, parseDollarsToCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { FUNCTIONAL_CLASS_LABELS, FUNCTIONAL_CLASS_ORDER } from '../functional-class'
import type { ExpenseCategory } from '@/lib/supabase/types/database'

interface Extracted {
  found: boolean
  vendor_name: string | null
  vendor_other_names: string[]
  vendor_type: 'organization' | 'individual'
  vendor_contact_id: string | null
  amount_cents: number | null
  expense_date: string | null
  invoice_date: string | null
  invoice_date_basis: 'stated' | 'billing_period' | 'inferred' | 'unknown'
  payment_date: string | null
  due_date: string | null
  service_period: string | null
  date_note: string | null
  description: string | null
  category_id: string | null
  category_source: 'vendor_history' | 'claude' | null
  likely_1099: boolean
  document_type: 'invoice' | 'receipt' | null
}

type Phase = 'uploading' | 'reading' | 'ready' | 'creating' | 'created' | 'upload_failed'

interface Row {
  key: string
  file: File
  mime: string
  phase: Phase
  path: string | null
  extracted: Extracted | null
  note: string | null // extraction notice (couldn't read, etc.)
  error: string | null // last create/upload error
  createdId: string | null
  warning: string | null
  /** SHA-256 of the file, to drop byte-identical copies within the batch. */
  hash: string | null
  /** An expense this exact file is already attached to (from the server). */
  duplicateOf: { expense_id: string; description: string; file_name: string } | null
  /** Filled in by demo mode's scripted reader, not Claude */
  demo: boolean
}

interface ExistingExpense {
  id: string
  amount_cents: number
  expense_date: string
  description: string
  vendor_contact_id: string | null
}

interface Props {
  categories: ExpenseCategory[]
  vendors: { id: string; display_name: string }[]
  existingExpenses: ExistingExpense[]
}

const CONCURRENCY = 3
const labelClass = 'block text-xs font-medium text-gray-600 mb-1'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000
}

export default function BulkInvoiceUpload({ categories, vendors, existingExpenses }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const formRefs = useRef(new Map<string, HTMLFormElement>())
  const queue = useRef<string[]>([])
  const active = useRef(0)
  const rowsRef = useRef<Row[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [rejected, setRejected] = useState<{ key: string; name: string; reason: string }[]>([])
  const [dragging, setDragging] = useState(false)
  const [creating, setCreating] = useState(false)
  const [defaultCategory, setDefaultCategory] = useState('')
  const [vendorOptions, setVendorOptions] = useState(vendors)
  // Vendor chosen per row (by hand or assigned from a new-vendor group).
  const [rowVendor, setRowVendor] = useState<Record<string, string>>({})
  // Bumped to remount a row's vendor picker when we assign it programmatically.
  const [vendorRev, setVendorRev] = useState<Record<string, number>>({})
  const [creatingVendorGroup, setCreatingVendorGroup] = useState<string | null>(null)
  const [vendorError, setVendorError] = useState<Record<string, string>>({})

  // Mirror committed rows for the async upload/extract/create callbacks, which
  // outlive the render that started them. Synced after commit (before paint and
  // any later event) rather than during render; addFiles also writes it eagerly
  // so the queue can read rows it has just added.
  useLayoutEffect(() => {
    rowsRef.current = rows
  }, [rows])

  // Unmatched payees, grouped so files from the same new vendor create it once.
  const newVendorGroups = groupNewVendors(
    rows.flatMap((r) =>
      r.phase === 'ready' && r.extracted && !r.extracted.vendor_contact_id && !rowVendor[r.key]
        ? [{ key: r.key, ...r.extracted }]
        : []
    )
  )
  const groupForRow = (key: string) => newVendorGroups.find((g) => g.rowKeys.includes(key)) ?? null

  function assignVendor(keys: string[], vendor: { id: string; display_name: string }) {
    setVendorOptions((prev) =>
      prev.some((v) => v.id === vendor.id)
        ? prev
        : [...prev, vendor].sort((a, b) => a.display_name.localeCompare(b.display_name))
    )
    setRowVendor((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, vendor.id])) }))
    setVendorRev((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, (prev[k] ?? 0) + 1])) }))
  }

  async function createGroupVendor(group: NewVendorGroup) {
    if (creatingVendorGroup) return
    setCreatingVendorGroup(group.id)
    setVendorError((prev) => ({ ...prev, [group.id]: '' }))
    const result = await createVendorForUpload({ name: group.name, kind: parseContactKind(group.type) })
    setCreatingVendorGroup(null)
    if (!result.ok) {
      setVendorError((prev) => ({ ...prev, [group.id]: result.error }))
      return
    }
    assignVendor(group.rowKeys, result.vendor)
  }

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // Warn before leaving with files uploaded but not yet filed.
  const unfiled = rows.filter((r) => r.path && r.phase !== 'created').length
  useEffect(() => {
    if (unfiled === 0) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [unfiled])

  async function uploadFile(row: Row): Promise<string> {
    const target = await createInvoiceUploadUrl(row.file.name, row.file.size)
    if (!target.ok) throw new Error(target.error)
    if (!target.signedUrl) {
      // Demo mode: no real storage, stage through the server.
      const body = new FormData()
      body.set('file', row.file)
      const staged = await stageInvoiceFile(body)
      if (!staged.ok) throw new Error(staged.error)
      return staged.path
    }
    const res = await fetch(target.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': row.mime, 'x-upsert': 'false' },
      body: row.file,
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(json?.message ?? `HTTP ${res.status}`)
    }
    return target.path
  }

  async function processRow(key: string) {
    const row = rowsRef.current.find((r) => r.key === key)
    if (!row) return
    let path: string
    try {
      path = await uploadFile(row)
    } catch (err) {
      update(key, {
        phase: 'upload_failed',
        error: `Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      })
      return
    }
    update(key, { phase: 'reading', path })

    try {
      const res = await fetch(withBasePath('/api/invoices/extract'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storage_path: path }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        enabled?: boolean
        extracted?: Extracted | null
        error?: string
        duplicate_of?: Row['duplicateOf']
        demo?: boolean
      }
      const note = !res.ok
        ? `Couldn't read this file (${json.error ?? res.status}). Fill it in by hand.`
        : json.enabled === false
          ? 'Auto-reading is off (no Claude API key). Fill it in by hand.'
          : !json.extracted
            ? "Couldn't read this file. Fill it in by hand."
            : !json.extracted.found
              ? "This doesn't look like an invoice or receipt. Check it, or remove it."
              : null
      update(key, {
        phase: 'ready',
        extracted: json.extracted ?? null,
        note,
        duplicateOf: json.duplicate_of ?? null,
        demo: json.demo === true,
      })
    } catch {
      update(key, { phase: 'ready', note: "Couldn't read this file. Fill it in by hand." })
    }
  }

  function pump() {
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const key = queue.current.shift()!
      active.current += 1
      void processRow(key).finally(() => {
        active.current -= 1
        pump()
      })
    }
  }

  async function fileHash(file: File): Promise<string | null> {
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      return null // no SubtleCrypto (insecure context): skip the identical-file check
    }
  }

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list)
    const hashes = await Promise.all(files.map(fileHash))
    const existingKeys = new Set(rowsRef.current.map((r) => r.key))
    const seenHashes = new Map(
      rowsRef.current.filter((r) => r.hash).map((r) => [r.hash!, r.file.name] as const)
    )
    const added: Row[] = []
    const newlyRejected: typeof rejected = []
    files.forEach((file, i) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (existingKeys.has(key)) return
      existingKeys.add(key)
      const check = checkInvoiceFile(file.name, file.size)
      if (!check.ok) {
        newlyRejected.push({ key: `${key}:${Math.random()}`, name: file.name, reason: check.reason })
        return
      }
      const hash = hashes[i]
      const sameAs = hash ? seenHashes.get(hash) : undefined
      if (sameAs) {
        newlyRejected.push({
          key: `${key}:${Math.random()}`,
          name: file.name,
          reason: `Identical to “${sameAs}” already in this batch, so it was left out.`,
        })
        return
      }
      if (hash) seenHashes.set(hash, file.name)
      added.push({
        key,
        file,
        mime: check.mime,
        phase: 'uploading',
        path: null,
        extracted: null,
        note: null,
        error: null,
        createdId: null,
        warning: null,
        hash,
        duplicateOf: null,
        demo: false,
      })
    })
    if (added.length > 0) {
      rowsRef.current = [...rowsRef.current, ...added]
      setRows(rowsRef.current)
      queue.current.push(...added.map((r) => r.key))
      pump()
    }
    if (newlyRejected.length > 0) setRejected((prev) => [...prev, ...newlyRejected])
  }

  function removeRow(row: Row) {
    queue.current = queue.current.filter((k) => k !== row.key)
    formRefs.current.delete(row.key)
    setRows((prev) => prev.filter((r) => r.key !== row.key))
    if (row.path && row.phase !== 'created') void discardInvoiceUpload(row.path)
  }

  function retryUpload(row: Row) {
    update(row.key, { phase: 'uploading', error: null })
    queue.current.push(row.key)
    pump()
  }

  async function createAll() {
    const targets = rowsRef.current.filter((r) => r.phase === 'ready' && r.path)
    if (targets.length === 0) return
    setCreating(true)
    for (const row of targets) {
      const form = formRefs.current.get(row.key)
      if (!form) continue
      const data = new FormData(form)
      const amountCents = parseDollarsToCents(String(data.get('amount') ?? ''))
      const fields = {
        expense_date: String(data.get('expense_date') ?? ''),
        description: String(data.get('description') ?? '').trim(),
        category_id: String(data.get('category_id') ?? ''),
      }
      const missing = [
        !fields.expense_date && 'date',
        amountCents === null && 'amount',
        !fields.description && 'description',
        !fields.category_id && 'category',
      ].filter(Boolean)
      if (missing.length > 0) {
        update(row.key, { error: `Missing ${missing.join(', ')}.` })
        continue
      }
      if ((row.duplicateOf || duplicateHint(row)) && data.get('create_anyway') !== 'on') {
        update(row.key, {
          error: 'Looks like a duplicate. Tick “Create anyway” to create it, or remove it.',
        })
        continue
      }

      update(row.key, { phase: 'creating', error: null })
      const result = await createExpenseFromUpload({
        storage_path: row.path!,
        file_name: row.file.name,
        mime_type: row.mime,
        size_bytes: row.file.size,
        expense_date: fields.expense_date,
        amount_cents: amountCents!,
        description: fields.description,
        category_id: fields.category_id,
        vendor_contact_id: String(data.get('vendor_contact_id') ?? '') || null,
        status: data.get('status') === 'paid' ? 'paid' : 'pending',
        is_1099_eligible: data.get('is_1099_eligible') === 'on',
      })
      if (result.ok) {
        update(row.key, { phase: 'created', createdId: result.id, warning: result.warning })
      } else {
        update(row.key, { phase: 'ready', error: result.error })
      }
    }
    setCreating(false)
  }

  function duplicateHint(row: Row): string | null {
    const x = row.extracted
    if (!x?.amount_cents) return null
    const sameAmount = (e: { amount_cents: number; expense_date: string; vendor_contact_id: string | null }) =>
      e.amount_cents === x.amount_cents &&
      ((x.vendor_contact_id && e.vendor_contact_id === x.vendor_contact_id) ||
        (x.expense_date && daysApart(e.expense_date, x.expense_date) <= 7))
    const recorded = existingExpenses.find(sameAmount)
    if (recorded) {
      return `Possible duplicate of “${recorded.description}” (${formatCents(recorded.amount_cents)}, ${formatDate(recorded.expense_date)}), already recorded.`
    }
    const inBatch = rows.find(
      (r) =>
        r.key !== row.key &&
        rows.indexOf(r) < rows.indexOf(row) &&
        r.extracted?.amount_cents === x.amount_cents &&
        ((x.vendor_contact_id && r.extracted?.vendor_contact_id === x.vendor_contact_id) ||
          (x.expense_date && r.extracted?.expense_date && daysApart(r.extracted.expense_date, x.expense_date) <= 7))
    )
    if (inBatch) return `Same amount as ${inBatch.file.name} in this batch. Make sure it isn't the same bill twice.`
    return null
  }

  const ready = rows.filter((r) => r.phase === 'ready').length
  const working = rows.filter((r) => r.phase === 'uploading' || r.phase === 'reading').length
  const created = rows.filter((r) => r.phase === 'created').length

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed text-center transition-colors ${
          dragging ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'
        } ${rows.length > 0 ? 'px-6 py-5' : 'px-6 py-12'}`}
      >
        <p className="text-sm font-medium text-gray-900">
          {rows.length > 0 ? 'Drop more files' : 'Drop invoices and receipts here'}
        </p>
        <p className="mt-1 text-xs text-gray-500">{INVOICE_ACCEPTED_LABEL}. Up to 20 MB each, as many as you like.</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn btn-secondary mt-3 text-sm"
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={INVOICE_ACCEPT_ATTR}
          aria-label="Choose invoice files"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {rejected.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
              Not included ({rejected.length})
            </p>
            <button onClick={() => setRejected([])} className="ml-auto text-xs text-amber-800 hover:underline">
              Dismiss
            </button>
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-900">
            {rejected.map((r) => (
              <li key={r.key}>
                <span className="font-medium">{r.name}</span>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <label htmlFor="bulk_category" className="text-gray-600">
              Category for rows without one
            </label>
            <select
              id="bulk_category"
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value)}
              className="input w-auto"
            >
              <option value="">None</option>
              <CategoryOptions categories={categories} />
            </select>
          </div>
          <p className="text-xs text-gray-500 flex-1 min-w-64">
            Everything starts as <strong>Pending</strong>: it stays out of QuickBooks and is marked
            Paid when its bank payment is matched in Banking. Choose Paid only for something paid
            outside the bank feeds.
          </p>
        </div>
      )}

      {rows.map((row, index) => (
        <UploadRow
          key={row.key}
          row={row}
          index={index}
          categories={categories}
          vendors={vendorOptions}
          vendorId={rowVendor[row.key] ?? row.extracted?.vendor_contact_id ?? null}
          vendorRev={vendorRev[row.key] ?? 0}
          newVendorGroup={groupForRow(row.key)}
          creatingVendor={creatingVendorGroup !== null && creatingVendorGroup === groupForRow(row.key)?.id}
          vendorError={vendorError[groupForRow(row.key)?.id ?? ''] || null}
          onVendorChange={(id) => setRowVendor((prev) => ({ ...prev, [row.key]: id }))}
          onVendorCreated={(vendor) => {
            // Created by hand in this row: reuse it for the row's batch-mates.
            const group = groupForRow(row.key)
            assignVendor(group ? group.rowKeys.filter((k) => k !== row.key) : [], vendor)
          }}
          onCreateVendor={() => {
            const group = groupForRow(row.key)
            if (group) void createGroupVendor(group)
          }}
          defaultCategory={defaultCategory}
          duplicate={row.phase === 'ready' ? duplicateHint(row) : null}
          registerForm={(el) => {
            if (el) formRefs.current.set(row.key, el)
            else formRefs.current.delete(row.key)
          }}
          onRemove={() => removeRow(row)}
          onRetryUpload={() => retryUpload(row)}
          disabled={creating}
        />
      ))}

      {rows.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
          <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void createAll()}
              disabled={creating || ready === 0}
              className="btn btn-primary"
            >
              {creating
                ? 'Creating…'
                : `Create ${ready === 1 ? '1 expense' : `${ready} expenses`}`}
            </button>
            <span className="text-sm text-gray-500">
              {working > 0 && `Reading ${working}… `}
              {created > 0 && `${created} created. `}
            </span>
            {created > 0 && (
              <Link href="/expenses" className="text-sm text-gray-500 underline hover:text-gray-900 ml-auto">
                Go to expenses
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryOptions({ categories }: { categories: ExpenseCategory[] }) {
  return (
    <>
      {FUNCTIONAL_CLASS_ORDER.map((fc) => {
        const group = categories.filter((c) => c.functional_class === fc)
        if (group.length === 0) return null
        return (
          <optgroup key={fc} label={FUNCTIONAL_CLASS_LABELS[fc]}>
            {group.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )
      })}
    </>
  )
}

function UploadRow({
  row,
  index,
  categories,
  vendors,
  vendorId,
  vendorRev,
  newVendorGroup,
  creatingVendor,
  vendorError,
  onVendorChange,
  onVendorCreated,
  onCreateVendor,
  defaultCategory,
  duplicate,
  registerForm,
  onRemove,
  onRetryUpload,
  disabled,
}: {
  row: Row
  index: number
  categories: ExpenseCategory[]
  vendors: { id: string; display_name: string }[]
  vendorId: string | null
  vendorRev: number
  newVendorGroup: NewVendorGroup | null
  creatingVendor: boolean
  vendorError: string | null
  onVendorChange: (id: string) => void
  onVendorCreated: (vendor: { id: string; display_name: string }) => void
  onCreateVendor: () => void
  defaultCategory: string
  duplicate: string | null
  registerForm: (el: HTMLFormElement | null) => void
  onRemove: () => void
  onRetryUpload: () => void
  disabled: boolean
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // null until picked by hand. The row mounts while uploading, before the
  // extraction exists, so the suggestion must be read at render time.
  const [pickedCategory, setPickedCategory] = useState<string | null>(null)
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  // Hand pick, else the extracted suggestion, else the batch-wide default.
  const effectiveCategory = pickedCategory ?? (row.extracted?.category_id || defaultCategory)

  const x = row.extracted
  const id = (field: string) => `row${index}_${field}`
  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-gray-100">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{row.file.name}</span>
      {row.demo && <DemoAiBadge />}
      {x?.document_type === 'receipt' && (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
          Receipt
        </span>
      )}
      {x?.document_type === 'invoice' && (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          Invoice
        </span>
      )}
      <span className="text-xs text-gray-400">{formatSize(row.file.size)}</span>
      <button
        type="button"
        onClick={() => {
          const url = previewUrl ?? URL.createObjectURL(row.file)
          if (!previewUrl) setPreviewUrl(url)
          window.open(url, '_blank', 'noopener')
        }}
        className="text-xs text-gray-500 underline hover:text-gray-900"
      >
        Open file
      </button>
      {row.phase !== 'created' && row.phase !== 'creating' && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="px-1 text-lg leading-none text-gray-400 hover:text-red-600"
          aria-label={`Remove ${row.file.name}`}
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  )

  if (row.phase === 'uploading' || row.phase === 'reading') {
    return (
      <div className="card">
        {header}
        <p className="px-4 py-3 text-sm text-gray-500">
          {row.phase === 'uploading' ? 'Uploading…' : 'Reading with Claude…'}
        </p>
      </div>
    )
  }

  if (row.phase === 'upload_failed') {
    return (
      <div className="card">
        {header}
        <div className="px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-red-600 flex-1">{row.error}</p>
          <button type="button" onClick={onRetryUpload} className="btn btn-secondary text-sm">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (row.phase === 'created') {
    return (
      <div className="card border-green-200 bg-green-50">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="text-green-800 font-medium">Created</span>
          <span className="min-w-0 flex-1 truncate text-gray-700">{row.file.name}</span>
          {row.createdId && (
            <Link href={`/expenses/${row.createdId}`} className="text-gray-600 underline hover:text-gray-900">
              View expense
            </Link>
          )}
        </div>
        {row.warning && <p className="px-4 pb-3 text-xs text-amber-700">{row.warning}</p>}
      </div>
    )
  }

  return (
    <div className="card">
      {header}
      <form
        ref={registerForm}
        onSubmit={(e) => e.preventDefault()}
        className="px-4 py-4 space-y-3"
      >
        {row.note && <p className="text-sm text-amber-700">{row.note}</p>}
        {x && (x.payment_date || x.due_date || x.service_period) && (
          <p className="text-xs text-gray-600">
            {[
              x.service_period && `For ${x.service_period}`,
              x.due_date && `Due ${formatDate(x.due_date)}`,
              x.payment_date && `Paid ${formatDate(x.payment_date)} per the document`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {row.duplicateOf && (
          <p className="text-sm rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2">
            This exact file is already attached to{' '}
            <Link href={`/expenses/${row.duplicateOf.expense_id}`} className="underline">
              “{row.duplicateOf.description}”
            </Link>
            . You probably don&rsquo;t need it again.
          </p>
        )}
        {duplicate && !row.duplicateOf && (
          <p className="text-sm rounded-md bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2">
            {duplicate}
          </p>
        )}
        {(row.duplicateOf || duplicate) && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="create_anyway" className="h-4 w-4 rounded border-gray-300" />
            Create anyway (it&rsquo;s not a duplicate)
          </label>
        )}
        <fieldset disabled={row.phase === 'creating'} className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor={id('date')} className={labelClass}>
              Date
            </label>
            <input
              id={id('date')}
              type="date"
              name="expense_date"
              defaultValue={x?.expense_date ?? ''}
              className="input"
            />
            {x?.date_note && <p className="text-xs text-gray-500 mt-1">{x.date_note}</p>}
            {!x?.expense_date && (
              <p className="text-xs text-amber-700 mt-1">No date found on the document. Enter the invoice date.</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={id('amount')} className={labelClass}>
              Amount
            </label>
            <MoneyInput
              id={id('amount')}
              name="amount"
              defaultValue={x?.amount_cents != null ? centsToDollarString(x.amount_cents) : undefined}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={id('status')} className={labelClass}>
              Status
            </label>
            <select id={id('status')} name="status" defaultValue="pending" className="input">
              <option value="pending">Pending (match to bank payment)</option>
              <option value="paid">Paid (outside bank feeds)</option>
            </select>
          </div>
          <div className="sm:col-span-3">
            <label htmlFor={id('vendor')} className={labelClass}>
              Vendor
            </label>
            <VendorSelect
              key={vendorRev}
              id={id('vendor')}
              name="vendor_contact_id"
              contacts={vendors}
              defaultValue={vendorId}
              suggestedName={x?.vendor_name}
              onChange={onVendorChange}
              onCreated={onVendorCreated}
            />
            {newVendorGroup && (
              <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                <p>
                  New vendor: <strong>{newVendorGroup.name}</strong> (
                  {newVendorGroup.type === 'individual' ? 'individual' : 'business'})
                  {x && x.vendor_other_names.length > 0 ? `, also named ${x.vendor_other_names.join(', ')}` : ''}.
                  {newVendorGroup.rowKeys.length > 1 &&
                    ` Also on ${newVendorGroup.rowKeys.length - 1} other ${newVendorGroup.rowKeys.length === 2 ? 'file' : 'files'} in this batch.`}
                </p>
                <button
                  type="button"
                  onClick={onCreateVendor}
                  disabled={creatingVendor}
                  className="btn btn-secondary text-xs mt-2"
                >
                  {creatingVendor
                    ? 'Creating…'
                    : newVendorGroup.rowKeys.length > 1
                      ? `Create vendor for all ${newVendorGroup.rowKeys.length} files`
                      : 'Create vendor'}
                </button>
                {vendorError && <p className="text-red-600 mt-1">{vendorError}</p>}
                <p className="text-blue-700/80 mt-1">
                  To use a different name or type, pick “Add new vendor” above instead.
                </p>
              </div>
            )}
          </div>
          <div className="sm:col-span-3">
            <label htmlFor={id('category')} className={labelClass}>
              Category
            </label>
            <select
              id={id('category')}
              name="category_id"
              value={effectiveCategory}
              onChange={(e) => setPickedCategory(e.target.value)}
              className="input"
            >
              <option value="">Select a category…</option>
              <CategoryOptions categories={categories} />
            </select>
            {x?.category_source && effectiveCategory === x.category_id && (
              <p className="text-xs text-gray-500 mt-1">
                {x.category_source === 'vendor_history'
                  ? 'Same category as past expenses from this vendor.'
                  : 'Suggested by Claude. Check it.'}
              </p>
            )}
          </div>
          <div className="sm:col-span-5">
            <label htmlFor={id('description')} className={labelClass}>
              Description
            </label>
            <input
              id={id('description')}
              type="text"
              name="description"
              defaultValue={x?.description ?? x?.vendor_name ?? row.file.name.replace(/\.[^.]+$/, '')}
              className="input"
            />
          </div>
          <div className="sm:col-span-1 flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="is_1099_eligible"
                defaultChecked={x?.likely_1099 ?? false}
                className="h-4 w-4 rounded border-gray-300"
              />
              1099
            </label>
          </div>
        </fieldset>
        {row.phase === 'creating' && <p className="text-sm text-gray-500">Creating…</p>}
        {row.error && <p className="text-sm text-red-600">{row.error}</p>}
      </form>
    </div>
  )
}
