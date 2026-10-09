import { describe, expect, it } from 'vitest'
import { buildPriMemoData } from './pri-memo-data'
import { PRI_MEMO_FIELDS } from '@/lib/pris/memo'
import type { Contact, Pri, PriMemo } from '@/lib/supabase/types/database'
import { makeContact, makeOrgSettings } from '@/lib/testing/fixtures'

const ts = { created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }

function makePri(overrides: Partial<Pri> = {}): Pri {
  return {
    id: 'pri1',
    recipient_contact_id: 'c1',
    instrument: 'safe',
    purpose: 'Affordable reading-assessment software for rural schools',
    amount_cents: 50_000_000,
    investment_date: '2026-07-01',
    board_approval_date: null,
    funded_date: null,
    method: null,
    status: 'committed',
    notes: null,
    qbo_txn_id: null,
    ...ts,
    ...overrides,
  }
}

function makeMemo(overrides: Partial<PriMemo> = {}): PriMemo {
  const answers = Object.fromEntries(
    PRI_MEMO_FIELDS.map(([key]) => [key, `Answer for ${key}`])
  ) as Pick<PriMemo, (typeof PRI_MEMO_FIELDS)[number][0]>
  return {
    id: 'm1',
    pri_id: 'pri1',
    ...answers,
    started_by: null,
    last_edited_by: null,
    ...ts,
    ...overrides,
  }
}

function makeRecipient(overrides: Partial<Contact> = {}): Contact {
  return makeContact({
    kind: 'organization',
    name: 'Brightpath Tools',
    display_name: 'Brightpath Tools',
    legal_name: 'Brightpath Tools Inc.',
    email: 'founders@brightpath.example.com',
    address_line1: '500 Example Boulevard',
    city: 'Springfield',
    state: 'IL',
    postal_code: '62702',
    country: 'US',
    tax_status: 'for_profit',
    ...ts,
    ...overrides,
  })
}

const settings = makeOrgSettings()

function rowByLabel(data: ReturnType<typeof buildPriMemoData>, label: string) {
  const row = data.headerRows.find((r) => r.label === label)
  if (!row) throw new Error(`Missing header row: ${label}`)
  return row
}

describe('buildPriMemoData', () => {
  it('titles the document as a mission-alignment memorandum', () => {
    const data = buildPriMemoData(makePri(), makeMemo(), makeRecipient(), null, settings, '2026-08-03')
    expect(data.title).toBe('Mission-Alignment Memorandum')
    expect(data.subtitle).toBe('Example Foundation Inc. - Program-Related Investment Record')
    expect(data.granteeName).toBe('Brightpath Tools Inc.')
  })

  it('builds the header table from the PRI record', () => {
    const data = buildPriMemoData(makePri(), makeMemo(), makeRecipient(), null, settings, '2026-08-03')
    expect(rowByLabel(data, 'Instrument').lines).toEqual(['SAFE'])
    expect(rowByLabel(data, 'Amount').lines).toEqual(['$500,000.00'])
    expect(rowByLabel(data, 'Tax status').lines).toEqual(['For-profit entity.'])
    expect(rowByLabel(data, 'Status').lines).toEqual(['Committed — not yet funded'])
    expect(rowByLabel(data, 'Key dates').lines).toEqual(['Investment dated July 1, 2026'])
  })

  it('shows funding details in key dates once funded', () => {
    const data = buildPriMemoData(
      makePri({ status: 'funded', funded_date: '2026-07-10', method: 'wire', board_approval_date: '2026-06-20' }),
      makeMemo(),
      makeRecipient(),
      null,
      settings,
      '2026-08-03'
    )
    expect(rowByLabel(data, 'Key dates').lines).toEqual([
      'Board approved June 20, 2026',
      'Investment dated July 1, 2026',
      'Funded (wire) July 10, 2026',
    ])
    expect(rowByLabel(data, 'Status').lines).toEqual(['Funded'])
  })

  it('renders all ten memo questions as numbered sections in order', () => {
    const data = buildPriMemoData(makePri(), makeMemo(), makeRecipient(), null, settings, '2026-08-03')
    expect(data.sections).toHaveLength(PRI_MEMO_FIELDS.length)
    expect(data.sections[0]).toEqual({
      number: 1,
      heading: PRI_MEMO_FIELDS[0][1],
      body: 'Answer for q_exempt_purpose',
    })
    expect(data.sections.map((s) => s.number)).toEqual(
      PRI_MEMO_FIELDS.map((_, i) => i + 1)
    )
  })
})
