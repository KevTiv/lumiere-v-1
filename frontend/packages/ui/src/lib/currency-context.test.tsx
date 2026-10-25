import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { CurrencyFormatProvider, useCurrencyFormat } from "./currency-context"
import { formatCurrencyAmount } from "./entity-row-utils"

const plain = (text: string) => text.replace(/ | /g, " ")

describe("formatCurrencyAmount", () => {
  it("places and groups the amount the way the locale writes it", () => {
    expect(plain(formatCurrencyAmount(1234.5, "EUR", { locale: "de-DE" }))).toBe("1.234,50 €")
    expect(plain(formatCurrencyAmount(1234.5, "EUR", { locale: "en" }))).toBe("€1,234.50")
    expect(plain(formatCurrencyAmount(1234.5, "BRL", { locale: "pt-BR" }))).toBe("R$ 1.234,50")
  })

  it("uses the currency's own number of decimals", () => {
    expect(plain(formatCurrencyAmount(1234, "RWF"))).toBe("RWF 1,234")
    expect(plain(formatCurrencyAmount(1234.5, "JPY", { locale: "ja-JP" }))).not.toContain(".")
  })

  it("defaults to en-US and USD, and survives an invalid locale", () => {
    expect(formatCurrencyAmount(5)).toBe("$5.00")
    expect(formatCurrencyAmount(5, "not-a-code")).toBe("$5.00")
    expect(formatCurrencyAmount(5, "USD", { locale: "not a locale!" })).toBe("$5.00")
  })
})

function format(wrapper: (props: { children: ReactNode }) => ReactNode) {
  return renderHook(() => useCurrencyFormat(), { wrapper }).result.current
}

const currencies = [
  { id: 7n, code: "rwf" },
  { id: "3", code: "EUR" },
  { id: 9, code: "not-a-code" },
]

describe("useCurrencyFormat", () => {
  it("behaves like the old defaults without a provider", () => {
    const { result } = renderHook(() => useCurrencyFormat())
    expect(result.current.money(5)).toBe("$5.00")
    expect(result.current.codeFor(7)).toBeUndefined()
    expect(result.current.codeFor("EUR")).toBe("EUR")
  })

  it("resolves a currency record id or ISO code to its code", () => {
    const f = format(({ children }) => <CurrencyFormatProvider currencies={currencies}>{children}</CurrencyFormatProvider>)
    expect(f.codeFor(7n)).toBe("RWF")
    expect(f.codeFor(7)).toBe("RWF")
    expect(f.codeFor("3")).toBe("EUR")
    expect(f.codeFor({ some: 7n })).toBe("RWF")
    expect(f.codeFor("USD")).toBe("USD")
    expect(f.codeFor(9)).toBeUndefined()
    expect(f.codeFor(99)).toBeUndefined()
  })

  it("shows an amount in its own currency, else the company's, in the user's locale", () => {
    const f = format(({ children }) => (
      <CurrencyFormatProvider locale="de-DE" defaultCode="eur" currencies={currencies}>
        {children}
      </CurrencyFormatProvider>
    ))
    expect(plain(f.money(1500.5, 3))).toBe("1.500,50 €")
    expect(plain(f.money(1500, 7))).toBe("1.500 RWF")
    expect(plain(f.money(1500.5))).toBe("1.500,50 €")
    expect(plain(f.money(1500.5, 99))).toBe("1.500,50 €")
  })

  it("inherits what a nested provider leaves out", () => {
    const f = format(({ children }) => (
      <CurrencyFormatProvider locale="pt-BR">
        <CurrencyFormatProvider defaultCode="BRL" currencies={currencies}>
          {children}
        </CurrencyFormatProvider>
      </CurrencyFormatProvider>
    ))
    expect(f.locale).toBe("pt-BR")
    expect(plain(f.money(1234.5))).toBe("R$ 1.234,50")
  })

  it("can show amounts in the short form for tiles and axes", () => {
    const f = format(({ children }) => <CurrencyFormatProvider defaultCode="USD">{children}</CurrencyFormatProvider>)
    expect(f.money(1_500_000, undefined, { compact: true })).toBe("$1.5M")
    expect(f.money(1_500_000)).toBe("$1,500,000.00")
  })

  it("passes on the row field that names a row's currency, unless a nearer provider says otherwise", () => {
    const f = format(({ children }) => (
      <CurrencyFormatProvider rowCurrencyKey="currencyId">
        <CurrencyFormatProvider defaultCode="EUR">{children}</CurrencyFormatProvider>
      </CurrencyFormatProvider>
    ))
    expect(f.rowCurrencyKey).toBe("currencyId")
    const g = format(({ children }) => (
      <CurrencyFormatProvider rowCurrencyKey="currencyId">
        <CurrencyFormatProvider rowCurrencyKey="companyCurrencyId">{children}</CurrencyFormatProvider>
      </CurrencyFormatProvider>
    ))
    expect(g.rowCurrencyKey).toBe("companyCurrencyId")
    expect(renderHook(() => useCurrencyFormat()).result.current.rowCurrencyKey).toBeUndefined()
  })
})
