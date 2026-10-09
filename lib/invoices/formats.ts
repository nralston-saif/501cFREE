// Which files invoice upload accepts. Client-safe: the drop zone rejects
// files up front, the extract route picks a reader by kind.

export type InvoiceFileKind = 'pdf' | 'docx' | 'image'

const FORMATS: Record<string, { kind: InvoiceFileKind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' },
}

const RESAVE: Record<string, string> = {
  doc: 'Word 97-2003 files can’t be read. Save it as a PDF or .docx first.',
  pages: 'Pages files can’t be read. Export it as a PDF or .docx first.',
  heic: 'iPhone HEIC photos can’t be read. Export it as JPG or PDF first.',
  heif: 'iPhone HEIC photos can’t be read. Export it as JPG or PDF first.',
}

export const MAX_INVOICE_FILE_BYTES = 20 * 1024 * 1024

/** Uploaded-but-not-yet-filed invoice files live under this documents-bucket prefix. */
export const INVOICE_UPLOAD_PREFIX = 'expense-import/'

export const INVOICE_ACCEPT_ATTR = Object.keys(FORMATS)
  .map((ext) => `.${ext}`)
  .join(',')

export const INVOICE_ACCEPTED_LABEL = 'PDF, Word (.docx), images (JPG, PNG, WEBP)'

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

export type InvoiceFileCheck =
  | { ok: true; kind: InvoiceFileKind; mime: string }
  | { ok: false; reason: string }

export function checkInvoiceFile(fileName: string, size: number): InvoiceFileCheck {
  const ext = extensionOf(fileName)
  const format = FORMATS[ext]
  if (!format) {
    return { ok: false, reason: RESAVE[ext] ?? `Unsupported file type. Use ${INVOICE_ACCEPTED_LABEL}.` }
  }
  if (size === 0) return { ok: false, reason: 'The file is empty.' }
  if (size > MAX_INVOICE_FILE_BYTES) return { ok: false, reason: 'Larger than 20 MB.' }
  return { ok: true, kind: format.kind, mime: format.mime }
}
