import { todayISO, todayInTimeZone } from './dates'

/**
 * Fiscal year helpers. A fiscal year is identified by the calendar year in
 * which it ends (e.g. FY2026 with a July start runs Jul 2025 - Jun 2026).
 * With a January start (fiscal_year_start_month = 1), FY2026 = calendar 2026.
 */

export interface FiscalYearRange {
  /** inclusive, YYYY-MM-DD */
  start: string
  /** exclusive, YYYY-MM-DD */
  end: string
}

export function fiscalYearRange(fiscalYear: number, startMonth: number): FiscalYearRange {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (startMonth === 1) {
    return { start: `${fiscalYear}-01-01`, end: `${fiscalYear + 1}-01-01` }
  }
  return {
    start: `${fiscalYear - 1}-${pad(startMonth)}-01`,
    end: `${fiscalYear}-${pad(startMonth)}-01`,
  }
}

/** The fiscal year a given YYYY-MM-DD date falls in */
export function fiscalYearOf(date: string, startMonth: number): number {
  const [year, month] = date.split('-').map(Number)
  if (startMonth === 1) return year
  return month >= startMonth ? year + 1 : year
}

/**
 * The current fiscal year as of today, in the given IANA time zone (the
 * organization's, from org settings) or the server's local zone if omitted.
 */
export function currentFiscalYear(startMonth: number, timeZone?: string): number {
  return fiscalYearOf(timeZone ? todayInTimeZone(timeZone) : todayISO(), startMonth)
}

/** The last day inside a range whose `end` is exclusive: '2027-01-01' -> '2026-12-31'. */
export function inclusiveEnd(exclusiveEnd: string): string {
  const [year, month, day] = exclusiveEnd.split('-').map(Number)
  const last = new Date(Date.UTC(year, month - 1, day - 1))
  return last.toISOString().slice(0, 10)
}

/**
 * Calendar year for the 1099 report. 1099s are filed per calendar year
 * whatever the fiscal year, so it has its own selector: a valid `cy` param,
 * else the current calendar year in the organization's time zone.
 */
export function reportCalendarYear(param: string | null | undefined, timeZone?: string): number {
  const parsed = Number(param)
  if (Number.isInteger(parsed) && parsed > 1900 && parsed < 3000) return parsed
  return Number((timeZone ? todayInTimeZone(timeZone) : todayISO()).slice(0, 4))
}
