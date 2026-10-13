import { describe, expect, it } from "vitest"
import { formatCurrencyAmount, formatEntityFieldValue, resolveCurrencyCode } from "./entity-row-utils"

describe("row currency formatting", () => {
  it("resolves ISO codes only", () => {
    expect(resolveCurrencyCode("eur")).toBe("EUR")
    expect(resolveCurrencyCode({ some: "GBP" })).toBe("GBP")
    expect(resolveCurrencyCode(12n)).toBeUndefined()
    expect(resolveCurrencyCode("7")).toBeUndefined()
    expect(resolveCurrencyCode("ABCD")).toBeUndefined()
    expect(resolveCurrencyCode(undefined)).toBeUndefined()
  })

  it("formats with the row's code and falls back to USD", () => {
    expect(formatCurrencyAmount(10, "EUR")).toBe("€10.00")
    expect(formatCurrencyAmount(10, "3")).toBe("$10.00")
    expect(formatCurrencyAmount(10)).toBe("$10.00")
    expect(formatEntityFieldValue(10, "currency")).toBe("$10.00")
    expect(formatEntityFieldValue(10, "currency", undefined, undefined, "EUR")).toBe("€10.00")
  })
})
