'use server'

import mammoth from 'mammoth'
import { requireMemberId, ActionError } from './helpers'

const MAX_BYTES = 10 * 1024 * 1024

/**
 * Converts an uploaded .docx to HTML for an in-page preview. The result is
 * untrusted (it comes from an applicant's document): callers must sanitize
 * it before rendering. Returns errors rather than throwing, since thrown
 * messages are hidden from the client in production.
 */
export async function previewDocx(
  formData: FormData
): Promise<{ html: string; error?: never } | { error: string; html?: never }> {
  try {
    await requireMemberId()
  } catch (err) {
    return { error: err instanceof ActionError ? err.message : 'Not authorized' }
  }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'No file provided' }
  if (file.size > MAX_BYTES) return { error: 'File exceeds the 10 MB limit' }

  try {
    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(await file.arrayBuffer()) })
    return { html }
  } catch {
    return { error: 'Could not read this document' }
  }
}
