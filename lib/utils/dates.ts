/** Format a YYYY-MM-DD date string for display: "Jun 12, 2026" */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format a YYYY-MM-DD date in full letter style: "June 12, 2026" */
export function formatDateLong(date: string | null | undefined): string {
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Today as YYYY-MM-DD in local time */
export function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Today as YYYY-MM-DD in the given IANA time zone, i.e. the organization's
 * calendar day regardless of where the server runs. en-CA gives us the
 * ISO-style format directly. Server code usually wants `orgToday()` from
 * lib/settings.ts, which reads the zone from org settings.
 */
export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** True if `timeZone` is an IANA zone this runtime recognizes */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Days from today until a YYYY-MM-DD date (negative if past) */
export function daysUntil(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86_400_000)
}

/**
 * Milliseconds elapsed since an ISO timestamp. Lives here (not inline in a
 * component) because reading the clock is impure; server components call it
 * once per request.
 */
export function msSince(timestamp: string): number {
  return Date.now() - new Date(timestamp).getTime()
}

/** The UTC calendar date (YYYY-MM-DD) `days` days before now */
export function utcDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Format an ISO timestamp as "Oct 9, 2026, 2:05 PM" in the given IANA zone
 * (the organization's, from org settings); UTC if the zone is unknown. Built
 * from parts so the output is plain ASCII on every runtime (no narrow
 * no-break space before AM/PM), which keeps server and client renders equal.
 */
export function formatTimestamp(timestamp: string | null | undefined, timeZone: string): string {
  if (!timestamp) return '—'
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return timestamp
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone }).formatToParts(at)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).formatToParts(at)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('month')} ${part('day')}, ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`
}
