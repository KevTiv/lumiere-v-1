import { describe, expect, it } from "vitest"
import { formatTimestampLike, getRowField } from "./entity-row-values"

describe("entity display compatibility adapters", () => {
  it("keeps PascalCase aliases and exact null precedence", () => {
    expect(getRowField({ display_name: "Alice" }, "DisplayName")).toBe("Alice")
    expect(getRowField({ displayName: null, display_name: "Alice" }, "displayName")).toBeNull()
    expect(getRowField(Object.create({ display_name: "inherited" }), "displayName")).toBeUndefined()
  })

  it("keeps explicit milliseconds and exact integer microsecond truncation", () => {
    expect(formatTimestampLike(1_725_494_400_000)?.toISOString()).toBe("2024-09-05T00:00:00.000Z")
    expect(formatTimestampLike("2024-09-05T00:00:00.000Z")?.getTime()).toBe(1_725_494_400_000)
    expect(formatTimestampLike({ microsSinceUnixEpoch: "9007199254740999" })?.getTime()).toBe(9_007_199_254_740)
    expect(formatTimestampLike({ microsSinceUnixEpoch: "invalid" })).toBeNull()
    expect(formatTimestampLike(new Date("invalid"))).toBeNull()
  })
})
