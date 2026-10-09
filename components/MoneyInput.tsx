'use client'

interface MoneyInputProps {
  name: string
  /** Element id, so a sibling <label htmlFor> can name the input. */
  id?: string
  defaultValue?: string
  /** When provided, the input is controlled (pair with onChange). */
  value?: string
  onChange?: (value: string) => void
  required?: boolean
  placeholder?: string
  readOnly?: boolean
  /** Max decimal places the input accepts. Defaults to 2 (whole cents). */
  maxDecimals?: number
}

/**
 * Insert thousands separators while typing: "10000" -> "10,000", preserving a
 * partial decimal entry ("1000.5" -> "1,000.5"). Strips characters the field
 * can't accept; parseDollarsToCents strips the commas again server-side.
 */
function addThousandsSeparators(raw: string, maxDecimals: number): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (cleaned === '') return ''
  const dot = cleaned.indexOf('.')
  const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (dot === -1) return group(cleaned)
  const decimals = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, maxDecimals)
  return `${group(cleaned.slice(0, dot))}.${decimals}`
}

/**
 * Reformat a whole-dollar entry with thousands separators on blur:
 * "1000" -> "1,000.00". Leaves blank or unparseable input untouched so the
 * pattern validation can still flag it. parseDollarsToCents strips the commas.
 */
function formatWholeDollars(raw: string): string {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (cleaned === '') return ''
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return raw
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Count the digits/dot before `end`, ignoring the commas that move around. */
function significantBefore(s: string, end: number): number {
  let n = 0
  for (let i = 0; i < end && i < s.length; i++) if (/[0-9.]/.test(s[i])) n++
  return n
}

/** Caret position sitting after `count` digits/dots in a formatted string. */
function caretAfterSignificant(s: string, count: number): number {
  if (count <= 0) return 0
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (/[0-9.]/.test(s[i]) && ++n === count) return i + 1
  }
  return s.length
}

/** Dollar-amount text input. Submit value is dollars; parse server-side with parseDollarsToCents. */
export default function MoneyInput({
  name,
  id,
  defaultValue,
  value,
  onChange,
  required,
  placeholder,
  readOnly,
  maxDecimals = 2,
}: MoneyInputProps) {
  const controlled = value !== undefined
  // Only the whole-dollar (2-decimal) case gets comma formatting; per-share
  // inputs use more decimals and shouldn't be reformatted.
  const autoFormat = !readOnly && maxDecimals === 2

  // Reformat in place on every keystroke, keeping the caret next to the digit
  // the user just typed even as commas shift. Writing el.value directly keeps
  // the DOM and the controlled parent (via onChange) in sync within one event,
  // so React's re-render is a no-op and doesn't clobber the caret.
  const handleFormattedChange = (el: HTMLInputElement) => {
    const raw = el.value
    const formatted = addThousandsSeparators(raw, maxDecimals)
    const caret = caretAfterSignificant(
      formatted,
      significantBefore(raw, el.selectionStart ?? raw.length)
    )
    el.value = formatted
    el.setSelectionRange(caret, caret)
    if (controlled) onChange?.(formatted)
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-900 text-sm">$</span>
      <input
        type="text"
        inputMode="decimal"
        id={id}
        name={name}
        {...(controlled
          ? { value, onChange: (e) => onChange?.(e.target.value) }
          : { defaultValue })}
        {...(autoFormat
          ? {
              onChange: (e) => handleFormattedChange(e.currentTarget),
              onBlur: (e) => {
                const formatted = formatWholeDollars(e.currentTarget.value)
                e.currentTarget.value = formatted
                if (controlled) onChange?.(formatted)
              },
            }
          : {})}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder ?? '0.00'}
        pattern={`[0-9,]*\\.?[0-9]{0,${maxDecimals}}`}
        // Inline padding-left so the leading "$" never overlaps the first digit
        // (a Tailwind utility loses the cascade to the `.input` shorthand padding).
        style={{ paddingLeft: '1.75rem' }}
        className={`input${readOnly ? ' bg-gray-100 text-gray-600' : ''}`}
      />
    </div>
  )
}
