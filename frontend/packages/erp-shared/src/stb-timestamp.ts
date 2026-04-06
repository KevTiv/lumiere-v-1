import type { Timestamp } from "spacetimedb"

/** Browser-side SpacetimeDB timestamp for reducer params (no `spacetimedb` runtime in the bundle). */
export function stbTimestampFromDate(d: Date): Timestamp {
  return { microsSinceUnixEpoch: BigInt(d.getTime()) * 1000n } as unknown as Timestamp
}
