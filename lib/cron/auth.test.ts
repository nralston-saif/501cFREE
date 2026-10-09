import { describe, expect, it } from 'vitest'
import { isAuthorizedCronRequest } from './auth'

describe('isAuthorizedCronRequest', () => {
  const secret = 'top-secret-token'

  it('accepts a matching bearer token', () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true)
  })

  it('rejects a missing Authorization header', () => {
    expect(isAuthorizedCronRequest(null, secret)).toBe(false)
  })

  it('rejects a wrong token', () => {
    expect(isAuthorizedCronRequest('Bearer nope', secret)).toBe(false)
  })

  it('rejects a raw token without the Bearer prefix', () => {
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false)
  })

  it('denies everything when no secret is configured (endpoint is never open)', () => {
    expect(isAuthorizedCronRequest('Bearer anything', undefined)).toBe(false)
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false)
    expect(isAuthorizedCronRequest(null, undefined)).toBe(false)
  })
})
