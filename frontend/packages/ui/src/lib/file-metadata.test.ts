import { describe, expect, it } from "vitest"
import { formatFileDate } from "./file-metadata"

describe("file metadata dates", () => {
  it("renders wire timestamps and browser timestamps consistently in the selected locale", () => {
    const date = new Date(2026, 9, 31, 12)
    const wireDate = { microsSinceUnixEpoch: BigInt(date.getTime()) * 1000n }
    expect(formatFileDate(wireDate, "en-US")).toBe(formatFileDate(date.getTime(), "en-US"))
    expect(formatFileDate(wireDate, "fr-FR")).toBe(date.toLocaleDateString("fr-FR", { month: "short", day: "numeric", year: "numeric" }))
  })

  it("keeps missing and malformed timestamps unavailable", () => {
    for (const missing of [null, undefined, "", "invalid", { microsSinceUnixEpoch: "invalid" }]) {
      expect(formatFileDate(missing, "en-US")).toBe("—")
    }
  })
})
