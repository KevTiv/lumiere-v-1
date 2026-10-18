import { describe, expect, it } from "vitest"

import {
  activeKpiTile,
  currencyCodeOfRow,
  filterRowsByKpi,
  formatMoneyTotals,
  sumByCurrency,
  toggleKpiKey,
  type KpiTileDef,
} from "./kpi-tiles"

const rows = [
  { id: 1, state: "a", amount: 10, currencyId: 1 },
  { id: 2, state: "b", amount: 5, currencyId: 2 },
  { id: 3, state: "a", amount: 7, currencyId: 1 },
]
const tiles: KpiTileDef[] = [
  { key: "a", label: "A", value: 2, matches: (row) => row.state === "a" },
  { key: "plain", label: "Plain", value: 3 },
]

describe("kpi tiles", () => {
  it("toggles a selection on and off", () => {
    expect(toggleKpiKey(null, "a")).toBe("a")
    expect(toggleKpiKey("a", "a")).toBeNull()
    expect(toggleKpiKey("a", "b")).toBe("b")
  })

  it("only treats a tile that can filter as active", () => {
    expect(activeKpiTile(tiles, "a")?.key).toBe("a")
    expect(activeKpiTile(tiles, "plain")).toBeNull()
    expect(activeKpiTile(tiles, "gone")).toBeNull()
    expect(activeKpiTile(tiles, null)).toBeNull()
  })

  it("narrows rows to the selected tile and leaves them alone otherwise", () => {
    expect(filterRowsByKpi(rows, tiles, "a").map((r) => r.id)).toEqual([1, 3])
    expect(filterRowsByKpi(rows, tiles, null)).toBe(rows)
    expect(filterRowsByKpi(rows, tiles, "gone")).toBe(rows)
  })

  it("sums per currency without mixing them", () => {
    const codes = new Map([["1", "USD"], ["2", "EUR"]])
    const totals = sumByCurrency(rows, (r) => Number(r.amount), currencyCodeOfRow(codes, "currencyId", "currency_id"))
    expect(totals).toEqual({ USD: 17, EUR: 5 })
    expect(sumByCurrency([{ amount: 4 }], (r) => Number(r.amount), currencyCodeOfRow(codes, "currencyId"))).toEqual({ "": 4 })
  })

  it("skips non-finite amounts and formats one or several currencies", () => {
    expect(sumByCurrency([{ a: Number.NaN }], (r) => Number(r.a), () => "USD")).toEqual({})
    const format = (amount: number, code: string) => `${code} ${amount}`
    expect(formatMoneyTotals({}, format)).toBe("—")
    expect(formatMoneyTotals({ USD: 1 }, format)).toBe("USD 1")
    expect(formatMoneyTotals({ USD: 1, EUR: 2 }, format)).toBe("EUR 2 · USD 1")
  })
})

import { isInMonthOf, kpiDate } from "./kpi-tiles"

describe("kpi dates", () => {
  it("reads micros objects, micros, millis, ISO strings and dates", () => {
    const ms = Date.UTC(2026, 9, 8)
    expect(kpiDate({ microsSinceUnixEpoch: BigInt(ms) * 1000n })?.getTime()).toBe(ms)
    expect(kpiDate({ microsSinceUnixEpoch: ms * 1000 })?.getTime()).toBe(ms)
    expect(kpiDate(ms)?.getTime()).toBe(ms)
    expect(kpiDate("2026-10-08T00:00:00.000Z")?.getTime()).toBe(ms)
    expect(kpiDate(new Date(ms))?.getTime()).toBe(ms)
  })

  it("returns null for empty, zero and unreadable values", () => {
    for (const value of [null, undefined, "", 0, "nope", {}, true]) expect(kpiDate(value)).toBeNull()
  })

  it("matches only dates in the same calendar month", () => {
    const now = new Date(2026, 9, 15)
    expect(isInMonthOf(new Date(2026, 9, 1), now)).toBe(true)
    expect(isInMonthOf(new Date(2026, 8, 30), now)).toBe(false)
    expect(isInMonthOf(new Date(2025, 9, 15), now)).toBe(false)
    expect(isInMonthOf(null, now)).toBe(false)
  })
})

import { currencyCodeMap, formatKpiMoney } from "./kpi-tiles"

describe("kpi money", () => {
  it("formats with a known currency and as a plain number otherwise", () => {
    expect(formatKpiMoney(1234.5, "EUR")).toBe("€1,234.50")
    expect(formatKpiMoney(1234.5, "")).toBe("1,234.50")
    expect(formatKpiMoney(1, "ZZZZ")).toBe("1.00")
  })

  it("maps currency ids to upper-cased codes", () => {
    const map = currencyCodeMap([{ id: 1n, code: "usd" }, { id: 2, code: "" }, { code: "EUR" }])
    expect([...map]).toEqual([["1", "USD"]])
  })
})
