import { describe, expect, it } from 'vitest'
import { buildMemoData, formatTaxStatusLine } from './memo-data'
import { MEMO_SECTION_FIELDS } from '@/lib/grants/memo'
import type {
  Contact,
  Disbursement,
  GrantOut,
  GrantProposal,
  ProposalMemo,
} from '@/lib/supabase/types/database'
import { makeContact, makeOrgSettings } from '@/lib/testing/fixtures'

const ts = { created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }

function makeProposal(overrides: Partial<GrantProposal> = {}): GrantProposal {
  return {
    id: 'p1',
    applicant_contact_id: 'c1',
    title: 'Rural reading corps',
    summary: null,
    program_areas: ['literacy'],
    amount_requested_cents: 600_000_000,
    received_date: '2026-06-18',
    entered_date: '2026-06-18',
    source: null,
    status: 'decided',
    origin: 'internal',
    applicant_name: null,
    applicant_email: null,
    organization_name: null,
    raw_submission: null,
    votes_revealed: true,
    decision: 'approved',
    decision_date: '2026-06-25',
    decision_notes: null,
    declined_stage: null,
    draft_response_email: null,
    response_email_sent_at: null,
    ...ts,
    ...overrides,
  }
}

function makeMemo(overrides: Partial<ProposalMemo> = {}): ProposalMemo {
  const sections = Object.fromEntries(
    MEMO_SECTION_FIELDS.map(([key]) => [key, `Body for ${key}`])
  ) as Pick<ProposalMemo, (typeof MEMO_SECTION_FIELDS)[number][0]>
  return {
    id: 'm1',
    proposal_id: 'p1',
    ...sections,
    header_purpose: 'Support of the grantee’s literacy programs',
    header_structure: 'Charitable gift under a written gift agreement; two installments.',
    header_decision: 'Approved at board review on June 25, 2026.',
    header_grantee_descriptor: 'a Delaware nonprofit corporation',
    started_by: null,
    last_edited_by: null,
    ...ts,
    ...overrides,
  }
}

function makeGrantee(overrides: Partial<Contact> = {}): Contact {
  return makeContact({
    kind: 'organization',
    name: 'Lakeside Learning',
    display_name: 'Lakeside Learning',
    legal_name: 'Lakeside Learning Inc.',
    email: 'hello@lakeside.example.org',
    address_line1: '200 Example Street',
    city: 'Springfield',
    state: 'IL',
    postal_code: '62701',
    country: 'US',
    tax_id: '00-0000000',
    tax_status: '501c3_public_charity',
    is_grantee: true,
    ...ts,
    ...overrides,
  })
}

const principal = { display_name: 'Morgan Lee', email: 'morgan@lakeside.example.org' }

function makeAward(overrides: Partial<GrantOut> = {}): GrantOut {
  return {
    id: 'a1',
    proposal_id: 'p1',
    grantee_contact_id: 'c1',
    purpose: 'Rural reading corps',
    amount_awarded_cents: 600_000_000,
    award_date: '2026-06-25',
    restriction: null,
    agreement_signed_date: '2026-06-26',
    status: 'active',
    notes: null,
    ...ts,
    ...overrides,
  }
}

function makeDisbursement(overrides: Partial<Disbursement> = {}): Disbursement {
  return {
    id: 'd1',
    grant_out_id: 'a1',
    amount_cents: 300_000_000,
    scheduled_date: '2026-07-01',
    paid_date: '2026-07-06',
    method: 'wire',
    status: 'paid',
    ...ts,
    ...overrides,
  }
}

const settings = makeOrgSettings()

function rowByLabel(data: ReturnType<typeof buildMemoData>, label: string) {
  const row = data.headerRows.find((r) => r.label === label)
  if (!row) throw new Error(`Missing header row: ${label}`)
  return row
}

describe('formatTaxStatusLine', () => {
  it('formats a public charity with EIN like the memorandum template', () => {
    expect(formatTaxStatusLine(makeGrantee())).toBe(
      'Tax-exempt under Section 501(c)(3); public charity described in Sections 509(a)(1)–(3). EIN 00-0000000.'
    )
  })

  it('formats a private foundation', () => {
    expect(
      formatTaxStatusLine(makeGrantee({ tax_status: '501c3_private_foundation', tax_id: null }))
    ).toBe('Tax-exempt under Section 501(c)(3); private foundation.')
  })

  it('shows EIN alone when tax status is missing', () => {
    expect(formatTaxStatusLine(makeGrantee({ tax_status: null }))).toBe(
      'Tax status not on file. EIN 00-0000000.'
    )
  })

  it('falls back when nothing is on file', () => {
    expect(formatTaxStatusLine(null)).toBe('Not on file')
    expect(formatTaxStatusLine(makeGrantee({ tax_status: null, tax_id: null }))).toBe(
      'Not on file'
    )
  })
})

describe('buildMemoData', () => {
  it('joins legal name with the grantee descriptor and address', () => {
    const data = buildMemoData(
      makeProposal(),
      makeMemo(),
      makeGrantee(),
      principal,
      makeAward(),
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(data, 'Grantee').lines).toEqual([
      'Lakeside Learning Inc., a Delaware nonprofit corporation',
      '200 Example Street',
      'Springfield, IL 62701',
    ])
  })

  it('uses the awarded amount when an award exists, requested otherwise', () => {
    const withAward = buildMemoData(
      makeProposal(),
      makeMemo(),
      makeGrantee(),
      principal,
      makeAward(),
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(withAward, 'Grant amount').lines).toEqual(['$6,000,000.00'])

    const noAward = buildMemoData(
      makeProposal({ status: 'in_review', decision: null, decision_date: null }),
      makeMemo(),
      makeGrantee(),
      principal,
      null,
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(noAward, 'Grant amount').lines).toEqual(['$6,000,000.00 (requested)'])
  })

  it('builds key dates from record data and only paid installments', () => {
    const data = buildMemoData(
      makeProposal(),
      makeMemo(),
      makeGrantee(),
      principal,
      makeAward(),
      [
        makeDisbursement(),
        makeDisbursement({ id: 'd2', status: 'scheduled', paid_date: null }),
      ],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(data, 'Key dates').lines).toEqual([
      'Proposal received June 18, 2026',
      'Approved June 25, 2026',
      'Grant agreement effective June 26, 2026',
      'Installment of $3,000,000.00 paid (wire) July 6, 2026',
    ])
  })

  it('renders em-dash placeholders for empty header free-text fields', () => {
    const data = buildMemoData(
      makeProposal({ received_date: null, decision: null, decision_date: null }),
      makeMemo({ header_structure: null, header_decision: '  ', header_purpose: null }),
      makeGrantee(),
      principal,
      null,
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(data, 'Structure').lines).toEqual(['—'])
    expect(rowByLabel(data, 'Decision').lines).toEqual(['—'])
    expect(rowByLabel(data, 'Key dates').lines).toEqual(['—'])
  })

  it('falls back to the award purpose when the header purpose is empty', () => {
    const data = buildMemoData(
      makeProposal(),
      makeMemo({ header_purpose: null }),
      makeGrantee(),
      principal,
      makeAward(),
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(data, 'Purpose').lines).toEqual(['Rural reading corps'])
  })

  it('numbers all ten sections in order with memo bodies', () => {
    const data = buildMemoData(
      makeProposal(),
      makeMemo(),
      makeGrantee(),
      principal,
      makeAward(),
      [],
      settings,
      '2026-07-30'
    )
    expect(data.sections).toHaveLength(10)
    expect(data.sections[0]).toEqual({
      number: 1,
      heading: 'Summary and recommendation',
      body: 'Body for q_summary_recommendation',
    })
    expect(data.sections[9].heading).toBe('Monitoring and evaluation')
  })

  it('falls back to the contact itself without a principal contact or tax details', () => {
    const data = buildMemoData(
      makeProposal(),
      makeMemo({ header_grantee_descriptor: null }),
      makeGrantee({ legal_name: null, tax_status: null, tax_id: null }),
      null,
      makeAward(),
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(data, 'Grantee').lines[0]).toBe('Lakeside Learning')
    expect(rowByLabel(data, 'Tax status').lines).toEqual(['Not on file'])
    expect(rowByLabel(data, 'Principal contact').lines).toEqual(['hello@lakeside.example.org'])
  })

  it('names the principal contact person and uses the org legal name in the subtitle', () => {
    const data = buildMemoData(
      makeProposal(),
      makeMemo(),
      makeGrantee(),
      principal,
      makeAward(),
      [],
      settings,
      '2026-07-30'
    )
    expect(rowByLabel(data, 'Principal contact').lines).toEqual([
      'Morgan Lee - morgan@lakeside.example.org',
    ])
    expect(data.subtitle).toBe('Example Foundation Inc. - Grant Record')
  })

  it('refuses to build without an organization legal name', () => {
    expect(() =>
      buildMemoData(
        makeProposal(),
        makeMemo(),
        makeGrantee(),
        principal,
        makeAward(),
        [],
        makeOrgSettings({ org_legal_name: null }),
        '2026-07-30'
      )
    ).toThrow(/legal name/)
  })
})
