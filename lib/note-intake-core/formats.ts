// Which files the notes inbox accepts, and how each is read. Client-safe:
// the drop zone uses this to reject files before upload, the pipeline uses it
// to pick a reader. Uploads go to the note-files storage bucket.

export type IntakeFileKind = 'pdf' | 'image' | 'text' | 'docx' | 'spreadsheet'

type FormatSpec = { kind: IntakeFileKind; mime: string }

const FORMATS: Record<string, FormatSpec> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' },
  txt: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/markdown' },
  markdown: { kind: 'text', mime: 'text/markdown' },
  csv: { kind: 'text', mime: 'text/csv' },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    kind: 'spreadsheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  xls: { kind: 'spreadsheet', mime: 'application/vnd.ms-excel' },
}

// Common formats we don't read yet
const NOT_YET: Record<string, string> = {
  pptx: 'PowerPoint',
  rtf: 'RTF',
  heic: 'HEIC photo',
  heif: 'HEIC photo',
}

// Formats that need re-saving before any tool can read them reliably
const RESAVE: Record<string, string> = {
  doc: 'Word 97-2003 files can’t be read. Save it as a PDF or .docx first.',
  ppt: 'PowerPoint 97-2003 files can’t be read. Save it as a PDF first.',
  pages: 'Pages files can’t be read. Export it as a PDF or .docx first.',
  numbers: 'Numbers files can’t be read. Export it to Excel (.xlsx) first.',
  key: 'Keynote files can’t be read. Export it as a PDF first.',
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_FILES_PER_INTAKE = 10
/** Demo mode stages files through a server action, whose body limit is 10 MB */
export const DEMO_STAGE_MAX_BYTES = 8 * 1024 * 1024

/** Value for <input type="file" accept>. */
export const ACCEPT_ATTR = Object.keys(FORMATS)
  .map((ext) => `.${ext}`)
  .join(',')

export const ACCEPTED_LABEL = 'PDF, Word (.docx), Excel (.xlsx, .xls), CSV, images (JPG, PNG, WEBP), text, Markdown'

export type FileCheck =
  | { ok: true; kind: IntakeFileKind; mime: string }
  | { ok: false; reason: string }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Decide from the file name (browsers report inconsistent MIME types). */
export function checkFile(name: string, sizeBytes: number): FileCheck {
  const ext = extensionOf(name)
  const spec = FORMATS[ext]
  if (!spec) {
    if (NOT_YET[ext]) {
      return { ok: false, reason: `${NOT_YET[ext]} files aren't supported yet. Save it as a PDF and drop that instead.` }
    }
    if (RESAVE[ext]) return { ok: false, reason: RESAVE[ext] }
    return { ok: false, reason: `Unsupported file type${ext ? ` (.${ext})` : ''}. Accepted: ${ACCEPTED_LABEL}.` }
  }
  if (sizeBytes === 0) return { ok: false, reason: 'The file is empty.' }
  if (sizeBytes > MAX_FILE_BYTES) return { ok: false, reason: 'The file is over the 20 MB limit.' }
  return { ok: true, kind: spec.kind, mime: spec.mime }
}

/** Storage-safe object name: {intakeId}/{uuid}-{sanitized name} */
export function storagePathFor(intakeId: string, fileName: string, uuid: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)
  return `${intakeId}/${uuid}-${safe}`
}
