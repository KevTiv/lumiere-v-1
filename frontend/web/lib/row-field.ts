/**
 * Tolerant readers for rows from the authorized HTTP query path: field names arrive camelCase,
 * but older payloads can still be snake_case, so every getter tries both.
 */
export type ReadRow = Record<string, unknown>

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
}

/** `row.fooBar ?? row.foo_bar`. */
export function field(row: ReadRow, camelKey: string): unknown {
  return row[camelKey] ?? row[snakeCase(camelKey)]
}

/** Id (or any scalar) as a string key; null when absent. */
export function idOf(row: ReadRow, camelKey: string): string | null {
  const value = field(row, camelKey)
  if (value == null || value === '') return null
  return String(value)
}

/** Finite number, or null when absent / not numeric. */
export function numberOf(row: ReadRow, camelKey: string): number | null {
  const value = field(row, camelKey)
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Trimmed text, or null when absent / blank. */
export function textOf(row: ReadRow, camelKey: string): string | null {
  const value = field(row, camelKey)
  if (value == null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** List of ids (arrays of bigint/number/string) as strings. */
export function idListOf(row: ReadRow, camelKey: string): string[] {
  const value = field(row, camelKey)
  if (!Array.isArray(value)) return []
  return value.filter((v) => v != null && v !== '').map((v) => String(v))
}

/** False only when the row says it is inactive (`active` / `isActive` false or 0). */
export function isRowActive(row: ReadRow, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = field(row, key)
    if (value === false || value === 0) return false
  }
  return true
}
