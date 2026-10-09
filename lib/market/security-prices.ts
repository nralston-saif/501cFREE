import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  SecurityPrice,
  StockContributionDetail,
} from '@/lib/supabase/types/database'

export const FMP_SOURCE = 'fmp'

interface FmpLightRow {
  symbol?: unknown
  date?: unknown
  price?: unknown
  volume?: unknown
}

export interface DailySecurityPriceInput {
  symbol: string
  price_date: string
  close_cents: number
  volume: number | null
  source: string
  fetched_at: string
}

export function normalizeSecuritySymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function centsFromPrice(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function volumeFromValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (isRecord(payload) && Array.isArray(payload.historical)) return payload.historical
  return []
}

/** Parse FMP's historical-price-eod/light response into cacheable price rows. */
export function parseFmpLightPrices(
  payload: unknown,
  fallbackSymbol: string,
  fetchedAt: string
): DailySecurityPriceInput[] {
  const symbol = normalizeSecuritySymbol(fallbackSymbol)
  return rowsFromPayload(payload)
    .map((row): DailySecurityPriceInput | null => {
      const item = row as FmpLightRow
      if (typeof item.date !== 'string') return null
      const closeCents = centsFromPrice(item.price)
      if (closeCents === null) return null
      return {
        symbol: normalizeSecuritySymbol(
          typeof item.symbol === 'string' && item.symbol.trim() ? item.symbol : symbol
        ),
        price_date: item.date,
        close_cents: closeCents,
        volume: volumeFromValue(item.volume),
        source: FMP_SOURCE,
        fetched_at: fetchedAt,
      }
    })
    .filter((row): row is DailySecurityPriceInput => row !== null)
}

function isoDaysBefore(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

async function latestCachedPrice(
  supabase: SupabaseClient<Database>,
  symbol: string,
  date: string
): Promise<SecurityPrice | null> {
  const { data } = await supabase
    .from('security_prices')
    .select('*')
    .eq('symbol', symbol)
    .eq('source', FMP_SOURCE)
    .gte('price_date', isoDaysBefore(date, 7))
    .lte('price_date', date)
    .order('price_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as unknown as SecurityPrice | null) ?? null
}

async function fetchFmpPrices(symbol: string, date: string): Promise<DailySecurityPriceInput[]> {
  const apiKey = process.env.FMP_API_KEY
  if (!apiKey) return []

  const fetchedAt = new Date().toISOString()
  const url = new URL('https://financialmodelingprep.com/stable/historical-price-eod/light')
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('from', isoDaysBefore(date, 7))
  url.searchParams.set('to', date)
  url.searchParams.set('apikey', apiKey)

  const response = await fetch(url, { next: { revalidate: 60 * 60 * 12 } })
  if (!response.ok) return []

  const payload = (await response.json()) as unknown
  return parseFmpLightPrices(payload, symbol, fetchedAt)
}

export async function getOrFetchDailySecurityPrice(
  supabase: SupabaseClient<Database>,
  rawSymbol: string | null,
  date: string | null
): Promise<SecurityPrice | null> {
  if (!rawSymbol || !date) return null
  const symbol = normalizeSecuritySymbol(rawSymbol)
  if (!symbol) return null

  const cached = await latestCachedPrice(supabase, symbol, date)
  if (cached) return cached

  const fetched = await fetchFmpPrices(symbol, date)
  if (fetched.length === 0) return null

  await supabase.from('security_prices').upsert(fetched, {
    onConflict: 'symbol,price_date,source',
  })

  return latestCachedPrice(supabase, symbol, date)
}

/** Most recent cached close for a symbol, regardless of how old (read path). */
export async function getLatestCachedSecurityPrice(
  supabase: SupabaseClient<Database>,
  rawSymbol: string | null
): Promise<SecurityPrice | null> {
  if (!rawSymbol) return null
  const symbol = normalizeSecuritySymbol(rawSymbol)
  if (!symbol) return null

  const { data } = await supabase
    .from('security_prices')
    .select('*')
    .eq('symbol', symbol)
    .eq('source', FMP_SOURCE)
    .order('price_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as unknown as SecurityPrice | null) ?? null
}

export interface SecurityPriceRefreshResult {
  symbol: string
  status: 'fetched' | 'cached' | 'failed'
  price_date: string | null
  close_cents: number | null
  error?: string
}

/**
 * Daily-refresh variant of getOrFetchDailySecurityPrice. Always attempts a live
 * FMP fetch (so a recent cache hit doesn't suppress the new EOD), upserts what
 * it gets, and falls back to the latest cached close when FMP is unavailable.
 * Never throws — returns a per-symbol result for the cron summary.
 */
export async function refreshLatestSecurityPrice(
  supabase: SupabaseClient<Database>,
  rawSymbol: string,
  asOfDate: string
): Promise<SecurityPriceRefreshResult> {
  const symbol = normalizeSecuritySymbol(rawSymbol)
  if (!symbol) {
    return { symbol: rawSymbol, status: 'failed', price_date: null, close_cents: null, error: 'empty symbol' }
  }

  let fetched: DailySecurityPriceInput[] = []
  let fetchError: string | null = null
  try {
    fetched = await fetchFmpPrices(symbol, asOfDate)
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'fetch failed'
  }

  if (fetched.length > 0) {
    const { error } = await supabase
      .from('security_prices')
      .upsert(fetched, { onConflict: 'symbol,price_date,source' })
    if (error) {
      return { symbol, status: 'failed', price_date: null, close_cents: null, error: error.message }
    }
    const latest = await latestCachedPrice(supabase, symbol, asOfDate)
    return {
      symbol,
      status: 'fetched',
      price_date: latest?.price_date ?? null,
      close_cents: latest?.close_cents ?? null,
    }
  }

  // No fresh data: report the most recent cached close if we have one.
  const cached = await latestCachedPrice(supabase, symbol, asOfDate)
  if (cached) {
    return { symbol, status: 'cached', price_date: cached.price_date, close_cents: cached.close_cents }
  }

  return {
    symbol,
    status: 'failed',
    price_date: null,
    close_cents: null,
    error: fetchError ?? (process.env.FMP_API_KEY ? 'no price returned' : 'FMP_API_KEY not set'),
  }
}

export interface StockValuation {
  held: boolean
  fmvTotalCents: number
  latestCloseCents: number | null
  latestCloseDate: string | null
  currentValueCents: number | null
  unrealizedGainLossCents: number | null
  saleNetCents: number | null
  realizedGainLossCents: number | null
}

/**
 * Pure estimate of a stock gift's current/realized position. Held positions
 * (no sale_date) are marked to the latest cached close; sold positions report
 * net proceeds. Gain/loss is measured against the internal FMV at receipt.
 */
export function computeStockValuation(
  detail: Pick<StockContributionDetail, 'shares' | 'fmv_total_cents' | 'sale_date' | 'sale_net_cents'>,
  latestPrice: Pick<SecurityPrice, 'close_cents' | 'price_date'> | null
): StockValuation {
  const fmvTotalCents = detail.fmv_total_cents
  const latestCloseCents = latestPrice?.close_cents ?? null
  const latestCloseDate = latestPrice?.price_date ?? null

  if (detail.sale_date !== null) {
    const saleNetCents = detail.sale_net_cents
    return {
      held: false,
      fmvTotalCents,
      latestCloseCents,
      latestCloseDate,
      currentValueCents: null,
      unrealizedGainLossCents: null,
      saleNetCents,
      realizedGainLossCents: saleNetCents !== null ? saleNetCents - fmvTotalCents : null,
    }
  }

  const currentValueCents =
    latestCloseCents !== null ? Math.round(detail.shares * latestCloseCents) : null
  return {
    held: true,
    fmvTotalCents,
    latestCloseCents,
    latestCloseDate,
    currentValueCents,
    unrealizedGainLossCents: currentValueCents !== null ? currentValueCents - fmvTotalCents : null,
    saleNetCents: null,
    realizedGainLossCents: null,
  }
}
