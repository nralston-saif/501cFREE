'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { createProposalWithLetter } from '@/lib/actions/grants-out'
import { previewDocx } from '@/lib/actions/documents'
import ApplicantSelect from '@/components/ApplicantSelect'
import MoneyInput from '@/components/MoneyInput'
import SubmitButton from '@/components/SubmitButton'
import ProgramAreaCheckboxes from '@/components/ProgramAreaCheckboxes'
import type { ProgramAreaOption } from '@/lib/program-areas'
import ActionForm from '@/components/ActionForm'

type Contact = { id: string; display_name: string }
type PreviewState =
  | { kind: 'none' }
  | { kind: 'pdf'; url: string; file: File }
  | { kind: 'docx-loading'; file: File }
  | { kind: 'docx'; html: string; file: File }
  | { kind: 'error'; message: string; file: File }

const PDF_MIMES = new Set(['application/pdf'])
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function isPdf(file: File): boolean {
  return PDF_MIMES.has(file.type) || file.name.toLowerCase().endsWith('.pdf')
}
function isDocx(file: File): boolean {
  return file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx')
}

export default function LetterUploadForm({
  contacts,
  programAreas,
  enteredDateDisplay,
}: {
  contacts: Contact[]
  programAreas: ProgramAreaOption[]
  enteredDateDisplay: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewState>({ kind: 'none' })

  // Revoke blob URLs on unmount/replace to avoid leaks
  useEffect(() => {
    return () => {
      if (preview.kind === 'pdf') URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const loadPreview = async (file: File) => {
    if (isPdf(file)) {
      const url = URL.createObjectURL(file)
      setPreview({ kind: 'pdf', url, file })
      return
    }
    if (isDocx(file)) {
      setPreview({ kind: 'docx-loading', file })
      try {
        const body = new FormData()
        body.set('file', file)
        const result = await previewDocx(body)
        if (result.error !== undefined) throw new Error(result.error)
        // Applicant-supplied content: sanitize before it reaches the DOM
        setPreview({ kind: 'docx', html: DOMPurify.sanitize(result.html), file })
      } catch (err) {
        setPreview({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not preview document',
          file,
        })
      }
      return
    }
    setPreview({
      kind: 'error',
      message: 'Unsupported file type — choose a PDF or DOCX.',
      file,
    })
  }

  const hasFile = preview.kind !== 'none'

  return (
    <div className={hasFile ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'max-w-2xl'}>
      {/* Form column */}
      <ActionForm action={createProposalWithLetter} className="card p-6 space-y-5">
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
            Proposal letter (PDF or DOCX) *
          </label>
          <input
            ref={fileInputRef}
            id="file"
            name="file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void loadPreview(file)
            }}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
          />
          <p className="text-xs text-gray-500 mt-1">
            The letter will preview on the right as you fill in the fields, and will be saved as
            an attachment on the proposal.
          </p>
        </div>

        <div>
          <label
            htmlFor="applicant_contact_id"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Applicant *
          </label>
          <ApplicantSelect id="applicant_contact_id" name="applicant_contact_id" contacts={contacts} required />
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Title *
          </label>
          <input id="title" name="title" type="text" required className="input" />
        </div>

        <div>
          <label htmlFor="summary" className="block text-sm font-medium text-gray-700 mb-1">
            Summary
          </label>
          <textarea id="summary" name="summary" rows={4} className="input" />
        </div>

        <ProgramAreaCheckboxes areas={programAreas} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="amount_requested" className="block text-sm font-medium text-gray-700 mb-1">
              Amount Requested/Suggested *
            </label>
            <MoneyInput id="amount_requested" name="amount_requested" required />
          </div>
          <div>
            <label htmlFor="source" className="block text-sm font-medium text-gray-700 mb-1">
              Source
            </label>
            <input
              id="source"
              name="source"
              type="text"
              placeholder="e.g. email, referral"
              className="input"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="received_date" className="block text-sm font-medium text-gray-700 mb-1">
              Received date
            </label>
            <input id="received_date" name="received_date" type="date" className="input" />
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Entered</span>
            <div className="input bg-gray-50 text-gray-600 cursor-not-allowed">
              {enteredDateDisplay}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <SubmitButton pendingLabel="Creating…">Create proposal</SubmitButton>
          <Link href="/grants-out" className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </ActionForm>

      {/* Preview column */}
      {hasFile && (
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
              <span className="text-xs font-medium text-gray-700 truncate">{preview.file.name}</span>
              <button
                type="button"
                onClick={() => {
                  if (preview.kind === 'pdf') URL.revokeObjectURL(preview.url)
                  setPreview({ kind: 'none' })
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                className="text-xs text-gray-500 hover:text-gray-900"
              >
                Remove
              </button>
            </div>

            {preview.kind === 'pdf' && (
              <embed
                src={preview.url}
                type="application/pdf"
                className="w-full h-[80vh] bg-white"
              />
            )}

            {preview.kind === 'docx-loading' && (
              <div className="p-8 text-sm text-gray-500">Extracting document…</div>
            )}

            {preview.kind === 'docx' && (
              <div
                className="docx-preview p-6 max-h-[80vh] overflow-y-auto bg-white text-sm text-gray-800 prose-styling"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            )}

            {preview.kind === 'error' && (
              <div className="p-6 text-sm text-red-600">{preview.message}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
