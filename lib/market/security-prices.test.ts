import { describe, expect, it } from 'vitest'
import {
  computeStockValuation,
  normalizeSecuritySymbol,
  parseFmpLightPrices,
} from './security-prices'

describe('security price helpers', () => {
  it('normalizes tickers for storage and lookup', () => {
    expect(normalizeSecuritySymbol(' aapl ')).toBe('AAPL')
  })

  it('parses FMP light EOD rows into integer cents', () => {
    const rows = parseFmpLightPrices(
      [
        { symbol: 'aapl', date: '2026-06-03', price: 197.85, volume: 52000000 },
        { symbol: 'AAPL', date: '2026-06-02', price: '196.12', volume: '41000000' },
      ],
      'AAPL',
      '2026-06-03T21:00:00.000Z'
    )

    expect(rows).toEqual([
      {
        symbol: 'AAPL',
        price_date: '2026-06-03',
        close_cents: 19785,
        volume: 52000000,
        source: 'fmp',
        fetched_at: '2026-06-03T21:00:00.000Z',
      },
      {
        symbol: 'AAPL',
        price_date: '2026-06-02',
        close_cents: 19612,
        volume: 41000000,
        source: 'fmp',
        fetched_at: '2026-06-03T21:00:00.000Z',
      },
    ])
  })

  it('ignores malformed rows', () => {
    const rows = parseFmpLightPrices(
      [{ date: '2026-06-03' }, { price: 197.85 }, { date: '2026-06-03', price: -1 }],
      'AAPL',
      '2026-06-03T21:00:00.000Z'
    )

    expect(rows).toEqual([])
  })
})

describe('computeStockValuation', () => {
  const held = { shares: 10, fmv_total_cents: 100_000, sale_date: null, sale_net_cents: null }

  it('marks a held position to the latest cached close (unrealized gain)', () => {
    const v = computeStockValuation(held, { close_cents: 12_000, price_date: '2026-06-12' })
    expect(v.held).toBe(true)
    expect(v.latestCloseCents).toBe(12_000)
    expect(v.latestCloseDate).toBe('2026-06-12')
    expect(v.currentValueCents).toBe(120_000) // 10 shares * $120.00
    expect(v.unrealizedGainLossCents).toBe(20_000) // $1,200 - $1,000
    expect(v.realizedGainLossCents).toBeNull()
  })

  it('reports an unrealized loss when the close is below FMV', () => {
    const v = computeStockValuation(held, { close_cents: 8_000, price_date: '2026-06-12' })
    expect(v.currentValueCents).toBe(80_000)
    expect(v.unrealizedGainLossCents).toBe(-20_000)
  })

  it('rounds fractional-share values to whole cents', () => {
    const v = computeStockValuation(
      { shares: 3.5, fmv_total_cents: 0, sale_date: null, sale_net_cents: null },
      { close_cents: 333, price_date: '2026-06-12' }
    )
    expect(v.currentValueCents).toBe(1166) // round(3.5 * 333 = 1165.5)
  })

  it('leaves current value null for a held position with no cached price', () => {
    const v = computeStockValuation(held, null)
    expect(v.held).toBe(true)
    expect(v.currentValueCents).toBeNull()
    expect(v.unrealizedGainLossCents).toBeNull()
  })

  it('reports realized gain/loss for a sold position', () => {
    const v = computeStockValuation(
      { shares: 10, fmv_total_cents: 100_000, sale_date: '2026-06-10', sale_net_cents: 90_000 },
      { close_cents: 12_000, price_date: '2026-06-12' }
    )
    expect(v.held).toBe(false)
    expect(v.saleNetCents).toBe(90_000)
    expect(v.realizedGainLossCents).toBe(-10_000) // sold below receipt FMV
    expect(v.currentValueCents).toBeNull()
    expect(v.unrealizedGainLossCents).toBeNull()
  })

  it('leaves realized gain/loss null when sale proceeds are not recorded', () => {
    const v = computeStockValuation(
      { shares: 10, fmv_total_cents: 100_000, sale_date: '2026-06-10', sale_net_cents: null },
      null
    )
    expect(v.held).toBe(false)
    expect(v.realizedGainLossCents).toBeNull()
  })
})
