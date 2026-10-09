import { describe, expect, it } from 'vitest'
import { formatTimestamp } from './dates'

describe('formatTimestamp', () => {
  it('formats an ISO timestamp in the given zone, ASCII only', () => {
    expect(formatTimestamp('2026-10-09T18:05:00.000Z', 'America/Chicago')).toBe('Oct 9, 2026, 1:05 PM')
    expect(formatTimestamp('2026-10-09T18:05:00.000Z', 'Not/AZone')).toBe('Oct 9, 2026, 6:05 PM')
    expect(formatTimestamp(null, 'UTC')).toBe('—')
  })
})
