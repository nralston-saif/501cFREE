import type { ProposedNote } from './proposal'

// Render a reviewed note into notes.content HTML. Sticks to elements the
// notes editor keeps on re-save (paragraphs, h3, lists, blockquote, strong)
// so editing a filed note never drops the transcript.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function list(items: string[]): string {
  return `<ul>${items.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join('')}</ul>`
}

export type RenderableNote = Pick<ProposedNote, 'title' | 'summary' | 'key_points' | 'follow_ups' | 'transcript'>

export function renderNoteHtml(note: RenderableNote): string {
  const parts: string[] = []
  if (note.title.trim()) parts.push(`<p><strong>${escapeHtml(note.title.trim())}</strong></p>`)
  if (note.summary.trim()) parts.push(`<h3>Summary</h3>${paragraphs(note.summary)}`)
  const keyPoints = note.key_points.map((k) => k.trim()).filter(Boolean)
  if (keyPoints.length) parts.push(`<h3>Key points</h3>${list(keyPoints)}`)
  const followUps = note.follow_ups.map((f) => f.trim()).filter(Boolean)
  if (followUps.length) parts.push(`<h3>Follow-ups</h3>${list(followUps)}`)
  if (note.transcript.trim()) {
    parts.push(`<h3>Original notes</h3><blockquote>${paragraphs(note.transcript)}</blockquote>`)
  }
  return parts.join('')
}
