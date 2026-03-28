/**
 * JSON-safe serialization for SpacetimeDB reducer bodies (Timestamps, bigints).
 */

import { Timestamp } from 'spacetimedb'

export function stdbParamsToJson(params: object): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(params, (_key, value: unknown) => {
      if (value instanceof Timestamp) {
        return { microsSinceUnixEpoch: String(value.microsSinceUnixEpoch) }
      }
      if (typeof value === 'bigint') {
        return String(value)
      }
      return value
    }),
  ) as Record<string, unknown>
}
