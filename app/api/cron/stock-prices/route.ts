import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cron/auth'
import {
  refreshLatestSecurityPrice,
  type SecurityPriceRefreshResult,
} from '@/lib/market/security-prices'
import type { StockContributionDetail } from '@/lib/supabase/types/database'

// Never cache or prerender — this mutates cached price data on each run.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type StockTickerRow = Pick<StockContributionDetail, 'ticker_symbol' | 'sale_date'>

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Daily EOD price refresh for currently-held stock gifts. Protect with
 * CRON_SECRET; Vercel Cron supplies the bearer token automatically.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service-role client: the cron has no signed-in user, so it must bypass RLS.
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('stock_contribution_details')
    .select('ticker_symbol, sale_date')
    .not('ticker_symbol', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as StockTickerRow[]

  // Distinct tickers of currently-held positions (no sale_date).
  const heldTickers = Array.from(
    new Set(
      rows
        .filter((r) => r.sale_date === null && r.ticker_symbol)
        .map((r) => (r.ticker_symbol as string).trim().toUpperCase())
    )
  )

  const asOf = todayIso()
  const results: SecurityPriceRefreshResult[] = []
  for (const ticker of heldTickers) {
    // Sequential to stay within FMP free-tier rate limits.
    results.push(await refreshLatestSecurityPrice(supabase, ticker, asOf))
  }

  const failures = results.filter((r) => r.status === 'failed')

  return NextResponse.json({
    ok: failures.length === 0,
    as_of: asOf,
    tickers_checked: heldTickers.length,
    fetched: results.filter((r) => r.status === 'fetched').length,
    cached: results.filter((r) => r.status === 'cached').length,
    failures: failures.map((f) => ({ symbol: f.symbol, error: f.error ?? 'unknown' })),
    results,
  })
}
