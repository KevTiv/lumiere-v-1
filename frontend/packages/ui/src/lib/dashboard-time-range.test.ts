import { describe, expect, it } from "vitest"
import { isTimestampInRange, previousPeriodMs, timeRangeToMs } from "./dashboard-time-range"

describe("dashboard history compatibility", () => {
  it("lets existing numeric filters cover all dates without comparing against an invented prior period", () => {
    const all = timeRangeToMs("all")
    expect(isTimestampInRange(Date.parse("1950-01-01"), all.startMs, all.endMs)).toBe(true)
    expect(isTimestampInRange(0, all.startMs, all.endMs)).toBe(true)
    expect(isTimestampInRange(NaN, all.startMs, all.endMs)).toBe(false)
    expect(previousPeriodMs("all")).toBeUndefined()
    expect(previousPeriodMs("all", undefined, { coverage: { startMs: 0, endMs: 100 } })).toBeUndefined()
  })

  it("keeps custom through dates inclusive and exact next-day boundaries exclusive", () => {
    const range = timeRangeToMs({ kind: "custom", from: "1960-01-01", through: "2025-12-31" })
    expect(new Date(range.startMs).toISOString()).toBe("1960-01-01T00:00:00.000Z")
    expect(new Date(range.endMs).toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(isTimestampInRange(range.endMs, range.startMs, range.endMs)).toBe(false)
  })
})
