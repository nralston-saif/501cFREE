import { describe, expect, it } from 'vitest'
import { secretMatches } from './secrets'

describe('secretMatches', () => {
  it('accepts only the exact secret', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true)
    expect(secretMatches('s3cret ', 's3cret')).toBe(false)
    expect(secretMatches('other', 's3cret')).toBe(false)
  })

  it('fails closed when either side is missing', () => {
    expect(secretMatches(null, 's3cret')).toBe(false)
    expect(secretMatches('', 's3cret')).toBe(false)
    expect(secretMatches('anything', undefined)).toBe(false)
    expect(secretMatches('', '')).toBe(false)
  })
})
