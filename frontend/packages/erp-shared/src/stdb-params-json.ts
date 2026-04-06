/**
 * JSON-safe serialization for SpacetimeDB reducer bodies (Timestamps, bigints).
 */

function isStdbTimestampLike(v: unknown): v is { microsSinceUnixEpoch: bigint } {
  return (
    typeof v === "object" &&
    v !== null &&
    "microsSinceUnixEpoch" in v &&
    typeof (v as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch === "bigint"
  )
}

export function stdbParamsToJson(params: object): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(params, (_key, value: unknown) => {
      if (isStdbTimestampLike(value)) {
        return { microsSinceUnixEpoch: String(value.microsSinceUnixEpoch) }
      }
      if (typeof value === "bigint") {
        return String(value)
      }
      return value
    }),
  ) as Record<string, unknown>
}
