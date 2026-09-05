/**
 * Pure row property lookup primitives for upper-layer consumers.
 *
 * These operations do NOT interpret values — they only find the right key.
 * Use `firstOwnedKey` when null is a meaningful value (preserve null).
 * Use `firstNonNullKey` when null/undefined should be skipped.
 */

type Row = Record<string, unknown>

/**
 * Return the value of the first key that exists as an own property.
 * Preserves null — only skips keys that are not own properties.
 */
export function firstOwnedKey(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key]
    }
  }
  return undefined
}

/**
 * Return the value of the first key whose value is not null/undefined.
 * Uses own-property check (does not traverse prototype chain).
 */
export function firstNonNullKey(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key]
      if (value !== null && value !== undefined) {
        return value
      }
    }
  }
  return undefined
}

/**
 * Convert a camelCase key to snake_case.
 */
export function toSnakeCase(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase()
}

/**
 * Convert a snake_case key to camelCase.
 */
export function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * Look up a row field trying exact, snake_case, and camelCase variants.
 * Uses own-property checks. Preserves null — only skips missing keys.
 */
export function getRowField(row: Row, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
  const snake = toSnakeCase(key)
  if (Object.prototype.hasOwnProperty.call(row, snake)) return row[snake]
  const camel = toCamelCase(key)
  if (Object.prototype.hasOwnProperty.call(row, camel)) return row[camel]
  return undefined
}
