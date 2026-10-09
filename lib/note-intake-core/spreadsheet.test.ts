import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { spreadsheetToText } from './server'

function book(sheets: Record<string, unknown[][]>, bookType: XLSX.BookType = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
}

describe('spreadsheetToText', () => {
  it('renders every sheet as labelled CSV, xlsx and legacy xls alike', () => {
    for (const type of ['xlsx', 'biff8'] as const) {
      const text = spreadsheetToText(
        book({ Budget: [['Category', 'Amount'], ['Travel', 4000]], Contacts: [['Name'], ['Aisha Okonkwo']] }, type)
      )
      expect(text).toContain('Sheet "Budget":\nCategory,Amount\nTravel,4000')
      expect(text).toContain('Sheet "Contacts":\nName\nAisha Okonkwo')
    }
  })

  it('uses cached values, never formulas', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b', 'sum'], [1, 2, 0]])
    ws['C2'] = { t: 'n', v: 3, f: 'A2+B2' }
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const text = spreadsheetToText(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    expect(text).toContain('1,2,3')
    expect(text).not.toContain('A2+B2')
  })

  it('marks a truncated sheet instead of cutting silently', () => {
    const rows = [['n'], ...Array.from({ length: 2500 }, (_, i) => [i])]
    const text = spreadsheetToText(book({ Big: rows }))
    expect(text).toContain('[Sheet truncated: showing the first 2001 of 2501 rows]')
  })
})
