import { describe, expect, it } from 'vitest'
import { isVotingMember, progressFromWeighedIn } from './voting'

// The reveal rule itself (every active voter voted or recused) is enforced
// and tested in the database: supabase/tests/schema.test.ts

const members = [{ id: 'alex' }, { id: 'sam' }, { id: 'jordan' }]

describe('progressFromWeighedIn', () => {
  it('counts members who have voted or recused', () => {
    expect(progressFromWeighedIn(members, new Set(['alex', 'sam']))).toEqual({ submitted: 2, total: 3 })
  })

  it('ignores reviewers who are no longer voting members', () => {
    expect(progressFromWeighedIn(members, new Set(['alex', 'former-admin']))).toEqual({
      submitted: 1,
      total: 3,
    })
  })

  it('handles proposals nobody has voted on yet', () => {
    expect(progressFromWeighedIn(members, undefined)).toEqual({ submitted: 0, total: 3 })
  })
})

describe('isVotingMember', () => {
  it('counts everyone in all_members mode', () => {
    expect(isVotingMember({ role: 'admin' }, 'all_members')).toBe(true)
    expect(isVotingMember({ role: 'staff' }, 'all_members')).toBe(true)
  })

  it('counts admins only in admins mode', () => {
    expect(isVotingMember({ role: 'admin' }, 'admins')).toBe(true)
    expect(isVotingMember({ role: 'staff' }, 'admins')).toBe(false)
  })
})
