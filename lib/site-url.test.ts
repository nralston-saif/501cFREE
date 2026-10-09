import { describe, expect, it } from 'vitest'
import { authCallbackUrl, requestOrigin, safeNextPath } from './site-url'
import { meetingIdFromRoom, meetingRoomId } from './liveblocks-rooms'

describe('safeNextPath', () => {
  it('keeps same-site paths', () => {
    expect(safeNextPath('/grants-out?tab=review')).toBe('/grants-out?tab=review')
  })

  it('rejects anything that could leave the site', () => {
    for (const raw of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'grants',
      // Browsers strip tab/CR/LF, turning these into //evil.example
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r//evil.example',
      '/ /evil.example',
    ]) {
      expect(safeNextPath(raw)).toBe('/')
    }
  })
})

describe('requestOrigin', () => {
  const headers = (h: Record<string, string>) => new Headers(h)

  it('prefers the forwarded host and protocol', () => {
    expect(
      requestOrigin(headers({ host: 'internal:3000', 'x-forwarded-host': 'office.example.org', 'x-forwarded-proto': 'https' }))
    ).toBe('https://office.example.org')
  })

  it('falls back to the host header', () => {
    expect(requestOrigin(headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
  })
})

describe('authCallbackUrl', () => {
  it('builds the callback from the fallback origin when no site URL is set', () => {
    expect(authCallbackUrl('http://localhost:3000/', '/auth/set-password')).toBe(
      'http://localhost:3000/auth/callback?next=%2Fauth%2Fset-password'
    )
  })
})

describe('meeting rooms', () => {
  const id = '3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f'

  it('round-trips a meeting id', () => {
    expect(meetingIdFromRoom(meetingRoomId(id))).toBe(id)
  })

  it('rejects other rooms', () => {
    expect(meetingIdFromRoom(`notes-meeting-${id}`)).toBeNull()
    expect(meetingIdFromRoom('meeting-not-a-uuid')).toBeNull()
  })
})
