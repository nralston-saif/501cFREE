import { describe, expect, it } from 'vitest'
import { checkFile, storagePathFor } from './formats'
import { mergeNotes, parseProposal, type KnownEntity } from './proposal'
import { renderNoteHtml } from './render'

const PERSON = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const PROPOSAL = '33333333-3333-3333-3333-333333333333'

const known = new Map<string, KnownEntity>([
  [`contact:${PERSON}`, { label: 'Jane Doe', kind: 'person' }],
  [`contact:${ORG}`, { label: 'Example Org', kind: 'organization' }],
  [`grant_proposal:${PROPOSAL}`, { label: 'Grant proposal: Field study' }],
])

function rawNote(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Call with Jane',
    meeting_date: '2026-09-28',
    summary: 'Discussed the grant.',
    key_points: ['Needs $50k', ''],
    follow_ups: ['Send memo'],
    transcript: 'jane — 50k',
    file_indexes: [0],
    links: [
      { entity_type: 'contact', entity_id: PERSON, confidence: 'high', evidence: 'Jane Doe in header' },
      { entity_type: 'contact', entity_id: ORG, confidence: 'medium', evidence: 'Example' },
      { entity_type: 'grant_proposal', entity_id: PROPOSAL, confidence: 'medium', evidence: 'the field study' },
    ],
    new_contacts: [],
    ...overrides,
  }
}

describe('parseProposal', () => {
  it('keeps links the server handed out and labels them from the server map', () => {
    const p = parseProposal({ notes: [rawNote()], warnings: [] }, { knownEntities: known, fileCount: 1 })
    expect(p.notes).toHaveLength(1)
    expect(p.notes[0].links.map((l) => l.label)).toEqual(['Jane Doe', 'Example Org', 'Grant proposal: Field study'])
    expect(p.notes[0].links.map((l) => l.contact_kind)).toEqual(['person', 'organization', undefined])
    expect(p.notes[0].key_points).toEqual(['Needs $50k'])
  })

  it('drops invented ids, wrong entity types and duplicates', () => {
    const p = parseProposal(
      {
        notes: [rawNote({
          links: [
            { entity_type: 'contact', entity_id: 'made-up', confidence: 'high', evidence: '' },
            { entity_type: 'pri', entity_id: PERSON, confidence: 'high', evidence: '' },
            { entity_type: 'contact', entity_id: PERSON, confidence: 'high', evidence: '' },
            { entity_type: 'contact', entity_id: PERSON, confidence: 'low', evidence: '' },
          ],
        })],
        warnings: [],
      },
      { knownEntities: known, fileCount: 1 }
    )
    expect(p.notes[0].links).toHaveLength(1)
    expect(p.notes[0].links[0].entity_id).toBe(PERSON)
  })

  it('rejects impossible dates and out-of-range file indexes', () => {
    const p = parseProposal(
      { notes: [rawNote({ meeting_date: '2026-02-30', file_indexes: [5, -1] })], warnings: [] },
      { knownEntities: known, fileCount: 2 }
    )
    expect(p.notes[0].meeting_date).toBeNull()
    // No valid source → attach every file rather than lose originals
    expect(p.notes[0].file_indexes).toEqual([0, 1])
  })

  it('skips empty notes and survives garbage', () => {
    expect(parseProposal(null, { knownEntities: known, fileCount: 1 }).notes).toEqual([])
    const p = parseProposal(
      { notes: [rawNote({ summary: '', transcript: '' })] },
      { knownEntities: known, fileCount: 1 }
    )
    expect(p.notes).toEqual([])
    expect(p.warnings.length).toBe(1)
  })
})

describe('new contacts', () => {
  it('keeps org role and title for people only, mapping unknown roles', () => {
    const p = parseProposal(
      {
        notes: [rawNote({
          new_contacts: [
            { kind: 'person', name: 'Tom', email: 'tom@example.org', organization: 'Helix', role_at_organization: 'founder', title: 'CTO', suggested_role: 'grantee', evidence: '' },
            { kind: 'organization', name: 'Helix', email: 'x@y', organization: 'z', role_at_organization: 'founder', title: 'CEO', suggested_role: 'bogus', evidence: '' },
            { kind: 'person', name: 'Ann', email: null, organization: null, role_at_organization: 'investor', title: null, suggested_role: null, evidence: '' },
            { kind: 'person', name: 'Bo', email: null, organization: 'Helix', role_at_organization: 'investor', title: null, suggested_role: null, evidence: '' },
          ],
        })],
        warnings: [],
      },
      { knownEntities: known, fileCount: 1 }
    )
    const [tom, helix, ann, bo] = p.notes[0].new_contacts
    expect(tom).toMatchObject({ role_at_organization: 'founder', title: 'CTO', suggested_role: 'grantee' })
    expect(helix).toMatchObject({ kind: 'organization', email: null, organization: null, role_at_organization: null, title: null, suggested_role: null })
    expect(ann.role_at_organization).toBeNull()
    expect(bo.role_at_organization).toBe('other')
  })
})

describe('mergeNotes', () => {
  it('combines content, files and links without duplicates', () => {
    const p = parseProposal(
      { notes: [rawNote(), rawNote({ title: 'Part 2', file_indexes: [1], summary: 'More.' })], warnings: [] },
      { knownEntities: known, fileCount: 2 }
    )
    const merged = mergeNotes(p.notes)
    expect(merged.title).toBe('Call with Jane')
    expect(merged.file_indexes).toEqual([0, 1])
    expect(merged.links).toHaveLength(3)
    expect(merged.summary).toBe('Discussed the grant.\n\nMore.')
  })
})

describe('renderNoteHtml', () => {
  it('escapes model text and renders the house format', () => {
    const html = renderNoteHtml({
      title: 'A <b>title</b>',
      summary: 'One.\n\nTwo',
      key_points: ['<script>x</script>'],
      follow_ups: [],
      transcript: 'line 1\nline 2',
    })
    expect(html).toContain('<p><strong>A &lt;b&gt;title&lt;/b&gt;</strong></p>')
    expect(html).toContain('<h3>Summary</h3><p>One.</p><p>Two</p>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('Follow-ups')
    expect(html).toContain('<blockquote><p>line 1<br>line 2</p></blockquote>')
  })
})

describe('checkFile', () => {
  it('accepts supported formats by extension, case-insensitively', () => {
    expect(checkFile('Notes.PDF', 10)).toEqual({ ok: true, kind: 'pdf', mime: 'application/pdf' })
    expect(checkFile('photo.jpeg', 10)).toMatchObject({ ok: true, kind: 'image' })
    expect(checkFile('memo.docx', 10)).toMatchObject({ ok: true, kind: 'docx' })
    expect(checkFile('Budget.XLSX', 10)).toMatchObject({ ok: true, kind: 'spreadsheet' })
    expect(checkFile('old-budget.xls', 10)).toMatchObject({ ok: true, kind: 'spreadsheet' })
  })

  it('explains what to do with unsupported files', () => {
    expect(checkFile('old.doc', 10)).toMatchObject({ ok: false, reason: expect.stringContaining('PDF or .docx') })
    expect(checkFile('deck.pptx', 10)).toMatchObject({ ok: false, reason: expect.stringContaining("aren't supported yet") })
    expect(checkFile('budget.numbers', 10)).toMatchObject({ ok: false, reason: expect.stringContaining('Export it to Excel') })
    expect(checkFile('big.pdf', 50 * 1024 * 1024)).toMatchObject({ ok: false })
    expect(checkFile('empty.txt', 0)).toMatchObject({ ok: false })
  })

  it('builds storage-safe paths', () => {
    expect(storagePathFor('abc', 'my notes (1).pdf', 'u')).toBe('abc/u-my_notes__1_.pdf')
  })
})
