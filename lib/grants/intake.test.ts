import { describe, expect, it } from 'vitest'
import { parseProposalSubmission as parse, type IntakeContext } from './intake'

const ctx: IntakeContext = {
  activeProgramAreaSlugs: ['literacy', 'family-support', 'teacher-training'],
  today: '2026-06-12',
}
const parseProposalSubmission = (body: Record<string, unknown>) => parse(body, ctx)

const valid = {
  applicant_name: 'Dana Rivers',
  applicant_email: 'dana@example.org',
  title: 'Library mapping for rural districts',
}

describe('parseProposalSubmission', () => {
  it('rejects when required fields are missing', () => {
    for (const missing of ['applicant_name', 'applicant_email', 'title'] as const) {
      const body: Record<string, unknown> = { ...valid }
      delete body[missing]
      const result = parseProposalSubmission(body)
      expect(result.ok).toBe(false)
    }
  })

  it('rejects non-string and empty required fields', () => {
    expect(parseProposalSubmission({ ...valid, title: 42 }).ok).toBe(false)
    expect(parseProposalSubmission({ ...valid, applicant_name: '   ' }).ok).toBe(false)
  })

  it('rejects invalid email addresses', () => {
    expect(parseProposalSubmission({ ...valid, applicant_email: 'not-an-email' }).ok).toBe(false)
    expect(parseProposalSubmission({ ...valid, applicant_email: 'a b@example.org' }).ok).toBe(false)
  })

  it('stamps pipeline defaults for an external submission', () => {
    const result = parseProposalSubmission(valid)
    if (!result.ok) throw new Error(result.error)
    expect(result.row.status).toBe('received')
    expect(result.row.origin).toBe('external')
    expect(result.row.source).toBe('website')
    expect(result.row.votes_revealed).toBe(false)
    expect(result.row.applicant_contact_id).toBeNull()
    expect(result.row.received_date).toBe('2026-06-12')
    expect(result.row.entered_date).toBe(result.row.received_date)
  })

  it('keeps only active program-area slugs, deduplicated', () => {
    const result = parseProposalSubmission({
      ...valid,
      program_areas: ['teacher-training', 'DROP TABLE', 'literacy', 'literacy', 42, 'retired-area'],
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.row.program_areas).toEqual(['literacy', 'teacher-training'])
    expect(result.row.raw_submission).toMatchObject({
      program_areas: ['literacy', 'teacher-training'],
    })
  })

  it('treats a missing or malformed program_areas field as none', () => {
    for (const program_areas of [undefined, 'literacy', { literacy: true }]) {
      const result = parseProposalSubmission({ ...valid, program_areas })
      if (!result.ok) throw new Error(result.error)
      expect(result.row.program_areas).toEqual([])
    }
  })

  it('tolerates junk amounts, parsing clean figures only', () => {
    const clean = parseProposalSubmission({ ...valid, amount_requested: '$50,000' })
    if (!clean.ok) throw new Error(clean.error)
    expect(clean.row.amount_requested_cents).toBe(5_000_000)

    const junk = parseProposalSubmission({ ...valid, amount_requested: 'TBD' })
    if (!junk.ok) throw new Error(junk.error)
    expect(junk.row.amount_requested_cents).toBeNull()
    expect(junk.row.raw_submission).toMatchObject({ amount_requested: 'TBD' })
  })

  it('clips oversized strings instead of storing megabytes', () => {
    const result = parseProposalSubmission({ ...valid, summary: 'x'.repeat(50_000) })
    if (!result.ok) throw new Error(result.error)
    expect(result.row.summary).toHaveLength(10_000)
  })

  it('echoes only known, clipped fields into raw_submission', () => {
    const result = parseProposalSubmission({
      ...valid,
      unexpected_key: 'x'.repeat(100_000),
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.row.raw_submission).not.toHaveProperty('unexpected_key')
  })
})
