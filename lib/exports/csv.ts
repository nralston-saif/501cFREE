// CSV building for the report exports (app/api/exports/[report]).

// Spreadsheet apps treat a cell starting with one of these as a formula,
// so text from contacts or descriptions could run as one when an export is
// opened ("CSV injection")
const FORMULA_START = /^[=+\-@\t\r]/
// Plain numbers (e.g. a negative dollar amount) are safe and stay numeric
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

/** Quote one cell, neutralizing anything a spreadsheet would run as a formula. */
export function escapeCsv(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function toCsv(header: string[], rows: (string | number | boolean | null)[][]): string {
  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n') + '\n'
}
