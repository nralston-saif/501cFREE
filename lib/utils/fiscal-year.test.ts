import { describe, expect, it } from 'vitest'
import { fiscalYearRange, inclusiveEnd, reportCalendarYear } from './fiscal-year'

describe('inclusiveEnd', () => {
  it('turns an exclusive end into the last day of the range', () => {
    expect(inclusiveEnd(fiscalYearRange(2026, 1).end)).toBe('2026-12-31')
    expect(inclusiveEnd(fiscalYearRange(2026, 7).end)).toBe('2026-06-30')
    expect(inclusiveEnd(fiscalYearRange(2024, 3).end)).toBe('2024-02-29')
  })
})

describe('reportCalendarYear', () => {
  it('uses a valid cy param, regardless of the fiscal year', () => {
    expect(reportCalendarYear('2025', 'America/Chicago')).toBe(2025)
  })

  it('falls back to the current calendar year for a missing or bad param', () => {
    const thisYear = Number(new Date().toISOString().slice(0, 4))
    for (const value of [undefined, null, '', 'abc', '99999']) {
      expect(reportCalendarYear(value, 'UTC')).toBe(thisYear)
    }
  })
})
