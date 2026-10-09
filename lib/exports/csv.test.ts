import { describe, expect, it } from 'vitest'
import { escapeCsv, toCsv } from './csv'

describe('escapeCsv', () => {
  it('quotes cells and doubles embedded quotes', () => {
    expect(escapeCsv('Acme "Fdn", Inc')).toBe('"Acme ""Fdn"", Inc"')
    expect(escapeCsv(null)).toBe('""')
    expect(escapeCsv(undefined)).toBe('""')
    expect(escapeCsv(12.5)).toBe('"12.5"')
    expect(escapeCsv(true)).toBe('"true"')
  })

  it('neutralizes cells a spreadsheet would run as formulas', () => {
    expect(escapeCsv('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(escapeCsv('+1+1')).toBe('"\'+1+1"')
    expect(escapeCsv('-2+3')).toBe('"\'-2+3"')
    expect(escapeCsv('@SUM(A1)')).toBe('"\'@SUM(A1)"')
    expect(escapeCsv('\t=1')).toBe('"\'\t=1"')
    expect(escapeCsv('\r=1')).toBe('"\'\r=1"')
  })

  it('leaves plain numbers and ordinary text alone', () => {
    expect(escapeCsv('-12.34')).toBe('"-12.34"')
    expect(escapeCsv(-5)).toBe('"-5"')
    expect(escapeCsv('Grant - final payment')).toBe('"Grant - final payment"')
    expect(escapeCsv('a=b')).toBe('"a=b"')
  })
})

describe('toCsv', () => {
  it('joins rows with a trailing newline', () => {
    expect(toCsv(['a', 'b'], [['=x', 1]])).toBe('"a","b"\n"\'=x","1"\n')
  })
})
