import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  scriptedDeclineEmail,
  scriptedGrantResearch,
  scriptedInvoiceExtraction,
  scriptedNoteIntake,
  scriptedPriResearch,
  stableHash,
  type DemoContact,
} from './demo-scripts'
import type { AiOrgContext } from './org-context'
import { DEMO_AI_MODEL, isAiAvailable, isScriptedAi } from './demo'
import { MEMO_SECTION_FIELDS } from '@/lib/grants/memo'
import { PRI_MEMO_FIELDS } from '@/lib/pris/memo'
import { runGrantResearch } from '@/lib/grants/research'
import { runPriResearch } from '@/lib/pris/research'
import { generateDeclineEmail } from '@/lib/grants/decline-email'
import { isNoteIntakeEnabled } from '@/lib/note-intake-core/config'
import { isInvoiceExtractionEnabled } from '@/lib/invoices/extract'

const CATEGORIES = ['Accounting fees', 'Legal fees', 'Software & IT', 'Travel', 'Insurance', 'Fundraising events']
const TODAY = '2026-07-20'

const ORG: AiOrgContext = {
  name: 'Example Literacy Fund',
  legalName: null,
  mission: 'Helping every child become a confident reader.',
  programAreas: [
    { label: 'Early literacy', description: null },
    { label: 'Family engagement', description: null },
  ],
  reviewerNames: ['Alex Rivera'],
}

describe('stableHash', () => {
  it('is deterministic and varies with input', () => {
    expect(stableHash('invoice.pdf')).toBe(stableHash('invoice.pdf'))
    expect(stableHash('invoice.pdf')).not.toBe(stableHash('invoice-2.pdf'))
  })
})

describe('addDays', () => {
  it('moves across month boundaries', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('scriptedInvoiceExtraction', () => {
  it('returns the same reading for the same file', () => {
    expect(scriptedInvoiceExtraction('scan_0042.pdf', CATEGORIES, TODAY)).toEqual(
      scriptedInvoiceExtraction('scan_0042.pdf', CATEGORIES, TODAY)
    )
  })

  it('picks the kind of bill from keywords in the file name', () => {
    const legal = scriptedInvoiceExtraction('Harbor_legal_invoice_July.pdf', CATEGORIES, TODAY)
    expect(legal.vendor_name).toBe('Harbor Street Legal LLP')
    expect(legal.category_name).toBe('Legal fees')
    expect(legal.document_type).toBe('invoice')
    expect(legal.likely_1099).toBe(true)

    const hotel = scriptedInvoiceExtraction('hotel-receipt.jpg', CATEGORIES, TODAY)
    expect(hotel.category_name).toBe('Travel')
    expect(hotel.document_type).toBe('receipt')
    expect(hotel.payment_date).toBe(hotel.invoice_date)
  })

  it('fills every field the review row needs, with plausible values', () => {
    for (const name of ['a.pdf', 'b.png', 'receipt (3).docx', 'IMG_2201.jpeg', 'accounting.pdf']) {
      const x = scriptedInvoiceExtraction(name, CATEGORIES, TODAY)
      expect(x.found).toBe(true)
      expect(x.vendor_name).toBeTruthy()
      expect(x.description).toBeTruthy()
      expect(x.amount_cents).toBeGreaterThan(0)
      expect(x.expense_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(x.expense_date! < TODAY).toBe(true)
      expect(x.expense_date! >= addDays(TODAY, -30)).toBe(true)
      expect(CATEGORIES).toContain(x.category_name)
    }
  })

  it('varies the amount by file name around the template amount', () => {
    const a = scriptedInvoiceExtraction('legal-1.pdf', CATEGORIES, TODAY).amount_cents!
    const b = scriptedInvoiceExtraction('legal-2.pdf', CATEGORIES, TODAY).amount_cents!
    expect(a).not.toBe(b)
    for (const cents of [a, b]) {
      expect(cents).toBeGreaterThanOrEqual(97_500 * 0.85)
      expect(cents).toBeLessThanOrEqual(97_500 * 1.15)
    }
  })

  it('falls back to an existing category when the template one is missing', () => {
    const x = scriptedInvoiceExtraction('legal.pdf', ['Office supplies'], TODAY)
    expect(x.category_name).toBe('Office supplies')
    expect(scriptedInvoiceExtraction('legal.pdf', [], TODAY).category_name).toBeNull()
  })
})

describe('scriptedGrantResearch', () => {
  const input = {
    applicantName: 'Prairie Libraries Network',
    title: 'Rural library book-mobile expansion',
    summary: 'Two additional book-mobiles serving 40 rural schools.',
    programAreaLabels: ['Early literacy'],
    amountDollars: '75,000',
    org: ORG,
  }

  it('drafts every memo section, the header, sources and open questions', () => {
    const draft = scriptedGrantResearch(input)
    for (const [key] of MEMO_SECTION_FIELDS) expect(draft.answers[key].length).toBeGreaterThan(40)
    expect(Object.keys(draft.answers)).toHaveLength(MEMO_SECTION_FIELDS.length)
    expect(draft.answers.q_summary_recommendation).toContain('Prairie Libraries Network')
    expect(draft.answers.q_summary_recommendation).toContain('$75,000')
    expect(draft.header.header_purpose).toContain('book-mobile')
    expect(draft.sources.length).toBeGreaterThanOrEqual(2)
    expect(draft.sources.length).toBeLessThanOrEqual(3)
    for (const s of draft.sources) expect(new URL(s.url).hostname).toBe('example.org')
    expect(draft.open_questions.length).toBeGreaterThanOrEqual(2)
  })

  it('is deterministic', () => {
    expect(scriptedGrantResearch(input)).toEqual(scriptedGrantResearch(input))
  })

  it('asks for a mission statement when none is recorded', () => {
    const draft = scriptedGrantResearch({ ...input, org: { ...ORG, mission: null } })
    expect(draft.open_questions.some((q) => q.includes('mission statement'))).toBe(true)
    expect(draft.answers.q_cause_area_fit).toContain('[TO CONFIRM]')
  })
})

describe('scriptedPriResearch', () => {
  it('answers all ten PRI questions with example.org sources', () => {
    const draft = scriptedPriResearch({
      recipientName: 'Brightpath Tools, PBC',
      instrumentLabel: 'SAFE',
      amountDollars: '200,000',
      purpose: 'Reading-assessment software priced for rural schools',
      org: ORG,
    })
    for (const [key] of PRI_MEMO_FIELDS) expect(draft.answers[key].length).toBeGreaterThan(40)
    expect(draft.answers.q_key_terms).toContain('SAFE, $200,000')
    for (const s of draft.sources) expect(s.url.startsWith('https://example.org/')).toBe(true)
    expect(draft.open_questions.length).toBeGreaterThanOrEqual(2)
  })
})

describe('scriptedDeclineEmail', () => {
  it('writes a polite draft with the applicant and organization names', () => {
    const email = scriptedDeclineEmail(
      {
        applicantName: 'Pat Marlow',
        organizationName: 'BigSigns Media',
        title: 'Reading awareness billboard campaign',
        declinedStage: 'review',
      },
      ORG
    )
    expect(email.startsWith('Subject: Your proposal to Example Literacy Fund: Reading awareness billboard campaign\n\n')).toBe(true)
    expect(email).toContain('Dear Pat,')
    expect(email).toContain('on behalf of BigSigns Media')
    expect(email).toContain('early literacy and family engagement')
    expect(email.endsWith('Warmly,\nThe Example Literacy Fund Team')).toBe(true)
  })

  it('greets an organization applicant by name', () => {
    const email = scriptedDeclineEmail(
      { applicantName: 'Riverbend Readers', organizationName: 'Riverbend Readers', title: 'X', declinedStage: 'decision' },
      { ...ORG, programAreas: [] }
    )
    expect(email).toContain('Dear Riverbend Readers team,')
    expect(email).toContain('outside our current grantmaking focus')
    expect(email).not.toContain('on behalf of')
  })
})

describe('scriptedNoteIntake', () => {
  const contacts: DemoContact[] = [
    { id: 'org-1', kind: 'organization', name: 'Riverbend Readers' },
    { id: 'org-2', kind: 'organization', name: 'Maple Family Foundation' },
    { id: 'person-1', kind: 'person', name: 'Morgan Lee' },
  ]
  const records = [{ id: 'gp-1', type: 'grant_proposal' as const, label: 'Grant proposal: Book-mobiles' }]

  it('proposes two notes linked to existing records, plus one new contact', () => {
    const proposal = scriptedNoteIntake(['notes.pdf'], contacts, records, TODAY)
    expect(proposal.notes).toHaveLength(2)
    const ids = new Set([...contacts.map((c) => c.id), ...records.map((r) => r.id)])
    for (const note of proposal.notes) {
      expect(note.links.length).toBeGreaterThan(0)
      for (const link of note.links) {
        expect(ids.has(link.entity_id)).toBe(true)
        expect(link.label).toBeTruthy()
      }
      expect(note.file_indexes).toEqual([0])
      expect(note.meeting_date! < TODAY).toBe(true)
    }
    const newContacts = proposal.notes.flatMap((n) => n.new_contacts)
    expect(newContacts).toHaveLength(1)
    expect(newContacts[0].email).toMatch(/@example\.org$/)
    // The two notes go to different organizations
    const orgIds = proposal.notes.map((n) => n.links.find((l) => l.contact_kind === 'organization')?.entity_id)
    expect(orgIds[0]).not.toBe(orgIds[1])
  })

  it('makes three notes from three or more files, each file used once', () => {
    const proposal = scriptedNoteIntake(['a.pdf', 'b.jpg', 'c.docx', 'd.txt'], contacts, records, TODAY)
    expect(proposal.notes).toHaveLength(3)
    expect(proposal.notes.flatMap((n) => n.file_indexes).sort()).toEqual([0, 1, 2, 3])
  })

  it('is deterministic and copes with an empty database', () => {
    expect(scriptedNoteIntake(['x.pdf'], contacts, records, TODAY)).toEqual(
      scriptedNoteIntake(['x.pdf'], contacts, records, TODAY)
    )
    const empty = scriptedNoteIntake(['x.pdf'], [], [], TODAY)
    expect(empty.notes).toHaveLength(2)
    expect(empty.notes.every((n) => n.links.length === 0)).toBe(true)
  })
})

describe('when the scripted provider runs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  function demoWithoutKey() {
    vi.stubEnv('NEXT_PUBLIC_USE_SUPABASE', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
  }

  it('runs in demo mode without a key, not with a key or outside demo mode', () => {
    demoWithoutKey()
    expect(isScriptedAi()).toBe(true)
    expect(isAiAvailable()).toBe(true)
    expect(isNoteIntakeEnabled()).toBe(true)
    expect(isInvoiceExtractionEnabled()).toBe(true)

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
    expect(isScriptedAi()).toBe(false)
    expect(isAiAvailable()).toBe(true)

    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_USE_SUPABASE', 'true')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.example.org')
    expect(isScriptedAi()).toBe(false)
    expect(isAiAvailable()).toBe(false)
    expect(isNoteIntakeEnabled()).toBe(false)
    expect(isInvoiceExtractionEnabled()).toBe(false)
  })

  it('answers the feature modules after a short delay, labelled as demo output', async () => {
    demoWithoutKey()
    vi.useFakeTimers()
    const research = runGrantResearch({
      applicantName: 'Riverbend Readers',
      title: 'Summer reading corps',
      summary: null,
      programAreaLabels: [],
      amountDollars: '50,000',
      receivedDate: null,
      source: null,
      crmContext: null,
      attachment: null,
      org: ORG,
    })
    const pri = runPriResearch({
      recipientName: 'Brightpath Tools, PBC',
      instrumentLabel: 'SAFE',
      amountDollars: '200,000',
      purpose: null,
      notes: null,
      investmentDate: null,
      crmContext: null,
      attachment: null,
      org: ORG,
    })
    const decline = generateDeclineEmail(
      {
        applicantName: 'Pat Marlow',
        organizationName: null,
        title: 'Billboards',
        summary: null,
        programAreaLabels: [],
        amountDollars: null,
        declinedStage: 'review',
        decisionNotes: null,
        reviewerComments: [],
      },
      ORG
    )
    await vi.advanceTimersByTimeAsync(2_000)
    const [r, p, d] = await Promise.all([research, pri, decline])
    expect(r.model).toBe(DEMO_AI_MODEL)
    expect(r.draft.header.header_purpose).toBe('Support of "Summer reading corps"')
    expect(p.model).toBe(DEMO_AI_MODEL)
    expect(Object.keys(p.draft.answers)).toHaveLength(PRI_MEMO_FIELDS.length)
    expect(d.model).toBe(DEMO_AI_MODEL)
    expect(d.email).toContain('Dear Pat,')
  })
})
