import { afterEach, describe, expect, it, vi } from "vitest"
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

describe("money presentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("shows negatives in brackets and uses each currency's own decimals", () => {
    expect(formatCurrencyAmount(-1200, "USD", { locale: "en-US" })).toBe("($1,200.00)")
    expect(formatCurrencyAmount(1200, "RWF", { locale: "en-US" })).toBe("RWF\u00a01,200")
    expect(formatCurrencyAmount(1200.5, "EUR", { locale: "de-DE" })).toBe("1.200,50\u00a0€")
    expect(formatEntityFieldValue(-5, "currency", undefined, undefined, "EUR", "de-DE")).toBe("-5,00\u00a0€")
  })

  it("says once, in development, that a figure named no currency", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.resetModules()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { formatCurrencyAmount: format } = await import("./entity-row-utils")
    expect(format(1)).toBe("$1.00")
    expect(format(2, "not-a-code")).toBe("$2.00")
    expect(format(3, "EUR")).toBe("€3.00")
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("stays quiet outside development", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { formatCurrencyAmount: format } = await import("./entity-row-utils")
    format(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
