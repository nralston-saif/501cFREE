import { describe, expect, it } from 'vitest'
import { echoMarker, parseEchoMarker } from './echo'

const ID = '3f2b8c1e-9a4d-4e7f-8b21-6c0d5e4a9f13'

describe('QBO echo marker', () => {
  it('round-trips an expense id', () => {
    expect(echoMarker(ID)).toBe(`Expense ${ID} (sent from back office)`)
    expect(parseEchoMarker(echoMarker(ID))).toBe(ID)
  })

  it('finds the marker at the start of a longer note', () => {
    expect(parseEchoMarker(`${echoMarker(ID)} — reimbursed to staff`)).toBe(ID)
  })

  it('ignores notes without the marker, or with it mid-note', () => {
    expect(parseEchoMarker(null)).toBeNull()
    expect(parseEchoMarker('Monthly SaaS')).toBeNull()
    expect(parseEchoMarker(`Paid by card. ${echoMarker(ID)}`)).toBeNull()
    expect(parseEchoMarker(`Expense ${ID}`)).toBeNull()
    expect(parseEchoMarker('Expense not-a-uuid (sent from back office)')).toBeNull()
  })
})
