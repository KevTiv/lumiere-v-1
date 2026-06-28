/**
 * JSON-safe serialization for SpacetimeDB reducer bodies (Timestamps, bigints).
 */

/** SpacetimeDB HTTP reducer params use Rust snake_case field names, not TS camelCase. */
export function camelToSnakeIdentifier(s: string): string {
  const relation = s.match(/^(.*)(M2O|M2M|O2M)$/)
  if (relation) {
    const base = relation[1]
      .replace(/([a-z])(\d)/g, "$1_$2")
      .replace(/(\d)([A-Z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
    return `${base}_${relation[2].toLowerCase()}`
  }

  return s
    .replace(/([a-z])(\d)/g, "$1_$2")
    .replace(/(\d)([A-Z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

function snakeCaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(snakeCaseKeys)
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[camelToSnakeIdentifier(key)] = snakeCaseKeys(nested)
    }
    return out
  }
  return value
}

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
  const serialized = JSON.parse(
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
  ) as unknown

  return snakeCaseKeys(serialized) as Record<string, unknown>
}
