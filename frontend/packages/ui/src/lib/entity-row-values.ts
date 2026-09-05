/** Pure entity-display adapters; no component imports are needed to test them. */
import { firstOwnedKey, toCamelCase, toSnakeCase } from "@lumiere/erp-shared/row-values"
import { isoToDate, millisToDate } from "@lumiere/erp-shared/timestamp-values"

export function getRowField(row: Record<string, unknown>, key: string): unknown {
  // Entity config historically accepts PascalCase keys as well as camelCase.
  return firstOwnedKey(row, key, toSnakeCase(key).replace(/^_/, ""), toCamelCase(key))
}

export function formatTimestampLike(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "number") return millisToDate(value)
  if (typeof value === "string") return isoToDate(value)
  if (value != null && typeof value === "object" && "microsSinceUnixEpoch" in value) {
    try {
      // Preserve integer division before conversion: converting large micros to
      // Number first can round across a millisecond boundary.
      const micros = BigInt(String(value.microsSinceUnixEpoch))
      return millisToDate(Number(micros / 1000n))
    } catch {
      return null
    }
  }
  return null
}
