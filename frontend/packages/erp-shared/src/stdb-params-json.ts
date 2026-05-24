/**
 * JSON-safe serialization for SpacetimeDB reducer bodies (Timestamps, bigints).
 */

/** Match `@lumiere/api-client` `stringifyReducerCallBody`: STDB HTTP expects JSON numbers for `u64`, not strings. */
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

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
        if (value < 0n) {
          throw new Error("stdbParamsToJson: negative bigint is not valid as u64 in JSON")
        }
        if (value > MAX_SAFE_BIGINT) {
          throw new Error(
            `stdbParamsToJson: bigint ${value} exceeds Number.MAX_SAFE_INTEGER; use a different encoding for this field`,
          )
        }
        return Number(value)
      }
      return value
    }),
  ) as Record<string, unknown>
}
