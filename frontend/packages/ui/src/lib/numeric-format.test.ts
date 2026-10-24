import { describe, expect, it } from "vitest"
import { formatLocaleNumber, localeDecimalSeparator, parseLocaleNumber, storedNumericValue } from "./numeric-format"

describe("parseLocaleNumber", () => {
  it("treats blank input as empty and junk as invalid", () => {
    expect(parseLocaleNumber("")).toBeUndefined()
    expect(parseLocaleNumber("   ")).toBeUndefined()
    expect(parseLocaleNumber("abc")).toBeNull()
    expect(parseLocaleNumber("12a")).toBeNull()
    expect(parseLocaleNumber(",")).toBeNull()
    expect(parseLocaleNumber("-")).toBeNull()
  })

  it("reads English grouping and decimals", () => {
    expect(parseLocaleNumber("1,234.50", "en-US")).toBe(1234.5)
    expect(parseLocaleNumber("1,234,567", "en-US")).toBe(1234567)
    expect(parseLocaleNumber("1,234", "en-US")).toBe(1234)
    expect(parseLocaleNumber("1.234", "en-US")).toBe(1.234)
    expect(parseLocaleNumber("0.5", "en-US")).toBe(0.5)
    expect(parseLocaleNumber(".5", "en-US")).toBe(0.5)
  })

  it("reads European grouping and decimals in any locale", () => {
    expect(parseLocaleNumber("1 234,50", "en-US")).toBe(1234.5)
    expect(parseLocaleNumber("1.234,50", "en-US")).toBe(1234.5)
    expect(parseLocaleNumber("1 234,50", "fr-FR")).toBe(1234.5)
    expect(parseLocaleNumber("1.234.567,89", "de-DE")).toBe(1234567.89)
    expect(parseLocaleNumber("1,5", "en-US")).toBe(1.5)
    expect(parseLocaleNumber("0,250", "en-US")).toBe(0.25)
    expect(parseLocaleNumber("1'234.50", "de-CH")).toBe(1234.5)
  })

  it("uses the locale to break the single-separator tie", () => {
    expect(parseLocaleNumber("1,234", "de-DE")).toBe(1.234)
    expect(parseLocaleNumber("1.234", "de-DE")).toBe(1234)
    expect(parseLocaleNumber("1.5", "de-DE")).toBe(1.5)
  })

  it("handles signs and rejects malformed grouping", () => {
    expect(parseLocaleNumber("-1,234.5", "en-US")).toBe(-1234.5)
    expect(parseLocaleNumber("−3", "en-US")).toBe(-3)
    expect(parseLocaleNumber("+3", "en-US")).toBe(3)
    expect(parseLocaleNumber("-0", "en-US")).toBe(0)
    expect(parseLocaleNumber("1,2,3", "en-US")).toBeNull()
    expect(parseLocaleNumber("1.234,5.6", "en-US")).toBeNull()
    expect(parseLocaleNumber("1,234.567,89", "en-US")).toBeNull()
    expect(parseLocaleNumber("1,23,456", "en-IN")).toBe(123456)
  })
})

describe("storedNumericValue", () => {
  it("reads numbers, bigints and machine strings from prefilled rows", () => {
    expect(storedNumericValue(12.5)).toBe(12.5)
    expect(storedNumericValue(7n)).toBe(7)
    expect(storedNumericValue("1234.5")).toBe(1234.5)
    expect(storedNumericValue("")).toBeUndefined()
    expect(storedNumericValue(null)).toBeUndefined()
    expect(storedNumericValue("12abc")).toBeNull()
    expect(storedNumericValue(Number.NaN)).toBeNull()
    expect(storedNumericValue({})).toBeNull()
  })
})

describe("formatLocaleNumber", () => {
  it("groups and pads decimals for display", () => {
    expect(formatLocaleNumber(1234.5, { locale: "en-US", decimals: 2 })).toBe("1,234.50")
    expect(formatLocaleNumber(1234.5, { locale: "de-DE", decimals: 2 })).toBe("1.234,50")
    expect(formatLocaleNumber(12.5, { locale: "en-US" })).toBe("12.5")
  })

  it("never hides typed precision behind the padded decimals", () => {
    expect(formatLocaleNumber(1.005, { locale: "en-US", decimals: 2 })).toBe("1.005")
    expect(formatLocaleNumber(1.5, { locale: "en-US", decimals: 3, maxDecimals: 1 })).toBe("1.500")
  })

  it("drops grouping while editing and ignores non-numbers", () => {
    expect(formatLocaleNumber(1234.5, { locale: "en-US", grouping: false })).toBe("1234.5")
    expect(formatLocaleNumber("", { locale: "en-US" })).toBe("")
    expect(formatLocaleNumber(Number.NaN, { locale: "en-US" })).toBe("")
  })

  it("round-trips its own output through the parser", () => {
    for (const locale of ["en-US", "de-DE", "fr-FR"]) {
      const text = formatLocaleNumber(1234567.89, { locale, decimals: 2 })
      expect(parseLocaleNumber(text, locale)).toBe(1234567.89)
    }
  })

  it("reports the locale decimal separator", () => {
    expect(localeDecimalSeparator("en-US")).toBe(".")
    expect(localeDecimalSeparator("fr-FR")).toBe(",")
  })
})
