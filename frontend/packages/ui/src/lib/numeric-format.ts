/** Locale-aware parsing and display for money, percent and quantity form fields. */

const SPACES = /[\s  '’]/g

/** The decimal separator the locale writes, e.g. "." for en-US or "," for fr-FR. */
export function localeDecimalSeparator(locale?: string): string {
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")
    return part?.value ?? "."
  } catch {
    return "."
  }
}

/**
 * Parse typed numeric input such as "1,234.50", "1 234,50", "1.234,50" or "-12".
 * Returns `undefined` for blank input and `null` when the text is not a number.
 *
 * When both "." and "," appear, the last one is the decimal separator. A single
 * separator is decimal when it is the locale's decimal separator; otherwise it is
 * read as grouping only when exactly three digits follow a short, non-zero lead
 * ("1,234" in en is 1234, "1,5" is 1.5 everywhere).
 */
export function parseLocaleNumber(input: string, locale?: string): number | null | undefined {
  let text = input.trim()
  if (text === "") return undefined
  let negative = false
  if (/^[-−+]/.test(text)) {
    negative = text[0] !== "+"
    text = text.slice(1)
  }
  text = text.replace(SPACES, "")
  if (text === "" || !/^[0-9.,]+$/.test(text)) return null

  const lastDot = text.lastIndexOf(".")
  const lastComma = text.lastIndexOf(",")
  let decimal: string | null = null
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? "." : ","
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ","
    const count = text.split(sep).length - 1
    if (count === 1) {
      const [lead, tail] = text.split(sep)
      const looksGrouped = tail.length === 3 && lead.length >= 1 && lead.length <= 3 && !/^0+$/.test(lead)
      decimal = sep === localeDecimalSeparator(locale) || !looksGrouped ? sep : null
    }
  }

  const group = decimal === "." ? "," : decimal === "," ? "." : null
  let intPart = text
  let fracPart = ""
  if (decimal) {
    const index = text.lastIndexOf(decimal)
    intPart = text.slice(0, index)
    fracPart = text.slice(index + 1)
    if (/[.,]/.test(fracPart)) return null
  }
  const groups = group || !decimal ? intPart.split(/[.,]/) : [intPart]
  if (groups.length > 1) {
    // Thousands groups of three, or Indian lakh groups of two before the last three.
    const rest = groups.slice(1)
    if (groups[0] === "" || rest.at(-1)?.length !== 3 || rest.some((g) => g.length !== 2 && g.length !== 3)) return null
  }
  if (decimal && intPart.includes(decimal)) return null
  const digits = groups.join("")
  if (digits === "" && fracPart === "") return null

  const value = Number(`${digits || "0"}.${fracPart || "0"}`)
  if (!Number.isFinite(value)) return null
  return negative && value !== 0 ? -value : value
}

const MACHINE_NUMBER = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i

/**
 * Read a stored form value as a number: numbers and bigints as-is, machine strings
 * such as "12.5" from prefilled rows too. `undefined` when blank, `null` when not a number.
 */
export function storedNumericValue(value: unknown): number | null | undefined {
  if (value === "" || value == null) return undefined
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return Number(value)
  if (typeof value !== "string") return null
  const text = value.trim()
  if (text === "") return undefined
  if (MACHINE_NUMBER.test(text)) return Number(text)
  return parseLocaleNumber(text) ?? null
}

export interface NumericFormatOptions {
  locale?: string
  /** Fraction digits always shown (money pads "12" to "12.00"). */
  decimals?: number
  /** Most fraction digits shown; never fewer than `decimals`, so typed precision is not hidden. */
  maxDecimals?: number
  /** Group thousands. Off while editing so the text stays easy to change. */
  grouping?: boolean
}

/** Format a stored number for display; returns "" for non-numbers. */
export function formatLocaleNumber(value: unknown, options: NumericFormatOptions = {}): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  const { locale, decimals, maxDecimals = 6, grouping = true } = options
  const minimumFractionDigits = Math.min(Math.max(decimals ?? 0, 0), 20)
  const maximumFractionDigits = Math.min(Math.max(maxDecimals, minimumFractionDigits), 20)
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, useGrouping: grouping }).format(value)
  } catch {
    return String(value)
  }
}
