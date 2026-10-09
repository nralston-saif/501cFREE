import { describe, expect, it } from 'vitest'
import { dateInTimeZone, isContactImagePath, meetingDay } from './crm'

describe('isContactImagePath', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  it('accepts objects inside the contact folder only', () => {
    expect(isContactImagePath(id, `contact-images/${id}/abc-logo.png`)).toBe(true)
    expect(isContactImagePath(id, `contact-images/${id}`)).toBe(false)
    expect(isContactImagePath(id, `contact-images/other/abc.png`)).toBe(false)
    expect(isContactImagePath(id, `grants/letter.pdf`)).toBe(false)
    expect(isContactImagePath(id, `contact-images/${id}/../other/x.png`)).toBe(false)
    expect(isContactImagePath(id, null)).toBe(false)
  })
})

describe('meetingDay', () => {
  it('keeps a date-only meeting on the date typed', () => {
    expect(meetingDay('2026-07-08T00:00:00+00:00', 'America/Los_Angeles')).toBe('2026-07-08')
    expect(meetingDay('2026-07-08', 'Asia/Tokyo')).toBe('2026-07-08')
  })

  it("puts a timed meeting on the organization's day", () => {
    // 02:30 UTC on the 9th is still the 8th in Los Angeles
    expect(meetingDay('2026-07-09T02:30:00+00:00', 'America/Los_Angeles')).toBe('2026-07-08')
    expect(meetingDay('2026-07-09T02:30:00+00:00', 'UTC')).toBe('2026-07-09')
  })
})

describe('dateInTimeZone', () => {
  it('uses the given zone, falling back to UTC', () => {
    expect(dateInTimeZone('2026-07-09T02:30:00Z', 'America/New_York')).toBe('2026-07-08')
    expect(dateInTimeZone('2026-07-09T02:30:00Z', 'Not/AZone')).toBe('2026-07-09')
  })
})
