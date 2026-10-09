import { describe, expect, it } from 'vitest'
import { canSendToQuickBooks } from './payment'

describe('canSendToQuickBooks', () => {
  it('allows an app expense that is not in QuickBooks', () => {
    expect(canSendToQuickBooks({ qbo_purchase_id: null, qbo_source: 'app' }, false)).toBe(true)
  })

  it('refuses one already sent', () => {
    expect(canSendToQuickBooks({ qbo_purchase_id: '123', qbo_source: 'app' }, false)).toBe(false)
  })

  it('refuses one that came from a QuickBooks journal entry or deposit (no purchase id)', () => {
    expect(canSendToQuickBooks({ qbo_purchase_id: null, qbo_source: 'qbo' }, false)).toBe(false)
  })

  it('refuses one linked from a Banking inbox item', () => {
    expect(canSendToQuickBooks({ qbo_purchase_id: null, qbo_source: 'app' }, true)).toBe(false)
  })
})
