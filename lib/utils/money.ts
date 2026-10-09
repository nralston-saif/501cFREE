const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** Format integer cents as US dollars: 150000 -> "$1,500.00" */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return usd.format(cents / 100)
}

/** Parse a user-entered dollar string into integer cents. Returns null if invalid. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/**
 * Parse a dollar string into cents while preserving sub-cent precision
 * (e.g. a per-share price of "172.8456" -> 17284.56 cents). Returns null if
 * invalid. Use parseDollarsToCents for whole amounts that must land on a cent.
 */
export function parseDollarsToCentsPrecise(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  // Round to 6 decimal places of a cent to absorb floating-point noise.
  return Math.round(value * 100 * 1e6) / 1e6
}

/** Format cents as a plain dollar amount for form inputs: 150000 -> "1500.00" */
export function centsToDollarString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

/**
 * Format a possibly-fractional per-share price (cents) as USD, showing up to
 * 6 decimal places: 17284.56 -> "$172.8456". Accepts the string Postgres
 * returns for numeric columns.
 */
export function formatPerShareCents(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return '—'
  const n = typeof cents === 'string' ? Number(cents) : cents
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 6,
  }).format(n / 100)
}

/**
 * Per-share form value preserving up to 6 decimals with no trailing zeros:
 * 17284.56 -> "172.8456". Accepts the string Postgres returns for numerics.
 */
export function centsToPerShareString(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return ''
  const n = typeof cents === 'string' ? Number(cents) : cents
  if (!Number.isFinite(n)) return ''
  return String(Number((n / 100).toFixed(6)))
}
