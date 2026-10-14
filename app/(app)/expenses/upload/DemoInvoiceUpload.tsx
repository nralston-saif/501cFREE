'use client'

import { useRef, useState } from 'react'
import DemoSampleNote from '@/components/DemoSampleNote'
import { useDemoRun } from '@/components/useDemoRun'
import { DEMO_DELAY_MS, DEMO_NOTES } from '@/lib/ai/demo-label'
import { scriptedInvoiceExtraction } from '@/lib/ai/demo-scripts'
import { checkInvoiceFile, INVOICE_ACCEPT_ATTR, INVOICE_ACCEPTED_LABEL } from '@/lib/invoices/formats'
import type { ExtractedInvoice } from '@/lib/invoices/normalize'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'

const SAMPLE_FILE = 'accounting-invoice.pdf'
const MAX_DEMO_FILES = 20

type Reading = { fileName: string; invoice: ExtractedInvoice }

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  )
}

const date = (d: string | null) => (d ? formatDate(d) : '—')

/**
 * Bulk invoice upload in demo mode without a key. Files are never uploaded
 * or read: after a few seconds each one gets a pre-written reading chosen
 * from its file name (scriptedInvoiceExtraction(), run in the browser).
 * Nothing is saved and no expenses are created.
 */
export default function DemoInvoiceUpload({ categoryNames, today }: { categoryNames: string[]; today: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])
  const [count, setCount] = useState(0)
  const { running, result, run, reset } = useDemoRun<Reading[]>(DEMO_DELAY_MS.invoices)

  function start(names: string[]) {
    if (running || names.length === 0) return
    setCount(names.length)
    run(() => names.map((fileName) => ({ fileName, invoice: scriptedInvoiceExtraction(fileName, categoryNames, today) })))
  }

  function addFiles(list: FileList) {
    const accepted: string[] = []
    const skipped: string[] = []
    for (const file of Array.from(list)) {
      const check = checkInvoiceFile(file.name, file.size)
      if (!check.ok) skipped.push(`${file.name}: ${check.reason}`)
      else if (accepted.length >= MAX_DEMO_FILES) skipped.push(`${file.name}: up to ${MAX_DEMO_FILES} files at a time in the demo.`)
      else accepted.push(file.name)
    }
    setRejected(skipped)
    start(accepted)
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!running) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'
        } ${running ? 'pointer-events-none opacity-60' : ''}`}
      >
        <p className="text-sm font-medium text-gray-900">Drop invoices and receipts here</p>
        <p className="mt-1 text-xs text-gray-500">
          {INVOICE_ACCEPTED_LABEL}. In this demo files are not uploaded or read.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="btn btn-secondary text-sm">
            Choose files
          </button>
          <button type="button" onClick={() => start([SAMPLE_FILE])} className="btn btn-primary text-sm">
            Try it with a sample file
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={INVOICE_ACCEPT_ATTR}
          aria-label="Choose invoice files"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {running && (
        <p className="text-sm text-gray-500 animate-pulse">
          Reading {count === 1 ? '1 file' : `${count} files`} with Claude… (demo)
        </p>
      )}

      {!running && result && (
        <div className="space-y-4">
          <DemoSampleNote>{DEMO_NOTES.invoices}</DemoSampleNote>
          {result.map(({ fileName, invoice: x }, i) => (
            <div key={`${fileName}:${i}`} className="card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{fileName}</span>
                {x.document_type && (
                  <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {x.document_type === 'receipt' ? 'Receipt' : 'Invoice'}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Vendor" value={x.vendor_name ?? '—'} />
                <Field label="Amount" value={<span className="tabular-nums">{x.amount_cents != null ? formatCents(x.amount_cents) : '—'}</span>} />
                <Field label="Category" value={x.category_name ?? '—'} />
                <Field label="Invoice date" value={date(x.invoice_date)} />
                {x.document_type === 'receipt' ? (
                  <Field label="Paid" value={date(x.payment_date)} />
                ) : (
                  <Field label="Due" value={date(x.due_date)} />
                )}
                <Field label="Service period" value={x.service_period ?? '—'} />
                <div className="sm:col-span-2">
                  <Field label="Description" value={x.description ?? '—'} />
                </div>
                <Field label="Likely 1099" value={x.likely_1099 ? 'Yes' : 'No'} />
              </dl>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              reset()
              setRejected([])
            }}
            className="text-sm text-gray-500 hover:underline"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
