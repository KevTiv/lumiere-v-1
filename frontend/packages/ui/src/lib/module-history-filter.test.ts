import { describe, expect, it } from "vitest"
import {
  MODULE_HISTORY_FIELDS,
  filterModuleHistoryRows,
  getModuleHistoryField,
  moduleHistoryTimestampMs,
  removeModuleHistoryFilter,
  resolveModuleHistoryFilter,
} from "./module-history-filter"

describe("module history drilldown", () => {
  it("allows only the declared module/tab date field and leaves other tabs unchanged", () => {
    expect(getModuleHistoryField("sales", "orders")).toEqual({ tabId: "orders", dateField: "dateOrder" })
    expect(getModuleHistoryField("sales", "invoices")).toBeNull()
    expect(getModuleHistoryField("__proto__", "orders")).toBeNull()
    const rows = [{ id: 1, writeDate: "2024-03-10", dateOrder: "2023-03-10" }]
    const inactive = resolveModuleHistoryFilter("sales", "invoices", "custom:2024-03-10:2024-03-10")
    expect(filterModuleHistoryRows(rows, inactive)).toBe(rows)
    const filter = resolveModuleHistoryFilter("sales", "orders", "custom:2024-03-10:2024-03-10")
    expect(filterModuleHistoryRows(rows, filter)).toEqual([])
    for (const [module, field] of Object.entries(MODULE_HISTORY_FIELDS)) {
      const scoped = resolveModuleHistoryFilter(module, field.tabId, "all")
      expect(filterModuleHistoryRows([{ [field.dateField]: "1940-01-01" }], scoped)).toHaveLength(1)
    }
  })

  it("keeps source date-only values and real instants aligned to the selected zone across DST", () => {
    const filter = resolveModuleHistoryFilter("sales", "orders", "custom:2024-03-10:2024-03-10", { timeZone: "America/New_York" })
    const rows = [
      { id: "date-only", dateOrder: "2024-03-10" },
      { id: "start", dateOrder: "2024-03-10T05:00:00.000Z" },
      { id: "last", date_order: "2024-03-11T03:59:59.999Z" },
      { id: "before", dateOrder: "2024-03-10T04:59:59.999Z" },
      { id: "end", dateOrder: "2024-03-11T04:00:00.000Z" },
      { id: "undated", dateOrder: null },
      { id: "explicitly-unknown", dateOrder: null, date_order: "2024-03-10" },
      { id: "invalid", dateOrder: "2024-02-30" },
    ]
    expect(filterModuleHistoryRows(rows, filter).map((row) => row.id)).toEqual(["date-only", "start", "last"])
  })

  it("reports malformed period/zone links and fails closed until they are cleared", () => {
    for (const raw of ["", "custom:2024-02-30:2024-03-31", "custom:2025-01-01:2024-01-01", "today:dateOrder"]) {
      const filter = resolveModuleHistoryFilter("sales", "orders", raw)
      expect(filter).toEqual({ status: "invalid", reason: "invalid-period" })
      expect(filterModuleHistoryRows([{ dateOrder: "2024-01-01" }], filter)).toEqual([])
    }
    expect(resolveModuleHistoryFilter("sales", "orders", "all", { timeZone: "not/a-zone" })).toEqual({ status: "invalid", reason: "invalid-time-zone" })
    expect(resolveModuleHistoryFilter("sales", "orders", "all", { timeZone: "+03:00" })).toEqual({ status: "invalid", reason: "invalid-time-zone" })
    const remaining = new URLSearchParams(removeModuleHistoryFilter("tab=orders&period=all&periodTimeZone=UTC&filter=currencyId%3A1&search=keep"))
    expect(remaining.get("period")).toBeNull()
    expect(remaining.get("periodTimeZone")).toBeNull()
    expect(remaining.get("filter")).toBe("currencyId:1")
    expect(remaining.get("tab")).toBe("orders")
    expect(remaining.get("search")).toBe("keep")
  })

  it("includes pre1970 and epoch dates in all history while leaving unknown dates out", () => {
    const filter = resolveModuleHistoryFilter("sales", "orders", "all")
    const rows = [
      { id: "old", dateOrder: { microsSinceUnixEpoch: BigInt(Date.parse("1969-12-31T00:00:00Z")) * 1000n } },
      { id: "epoch", dateOrder: 0 },
      { id: "missing", dateOrder: null },
      { id: "invalid", dateOrder: {} },
    ]
    expect(filterModuleHistoryRows(rows, filter).map((row) => row.id)).toEqual(["old", "epoch"])
  })
})

describe("module history timestamp decoding", () => {
  it("uses explicit units even near epoch, including negative microseconds and zero", () => {
    expect(moduleHistoryTimestampMs({ microsSinceUnixEpoch: -1000n })).toBe(-1)
    expect(moduleHistoryTimestampMs({ micros_since_unix_epoch: "-1000" })).toBe(-1)
    expect(moduleHistoryTimestampMs({ __timestamp_micros_since_unix_epoch__: 1000 })).toBe(1)
    expect(moduleHistoryTimestampMs({ some: { microsSinceUnixEpoch: 0n } })).toBe(0)
    expect(moduleHistoryTimestampMs({ some: new Date(0) })).toBe(0)
    expect(moduleHistoryTimestampMs(-1000)).toBe(-1000)
    expect(moduleHistoryTimestampMs(-1000, "UTC", "microseconds")).toBe(-1)
    expect(moduleHistoryTimestampMs(-1, "UTC", "microseconds")).toBe(-0.001)
    expect(moduleHistoryTimestampMs(new Date("1950-01-01"))).toBe(Date.parse("1950-01-01"))
    expect(moduleHistoryTimestampMs("1950-01-01T00:00:00Z")).toBe(Date.parse("1950-01-01"))
  })

  it("rejects unknown dates, impossible calendar dates and timestamps without explicit zones", () => {
    for (const value of [null, undefined, "", " ", true, {}, [], NaN, Infinity, new Date(NaN), { microsSinceUnixEpoch: "1.5" }, { microsSinceUnixEpoch: Number.MAX_SAFE_INTEGER + 1 }, "2024-02-30T00:00:00Z", "2024-03-10T00:00:00", "March 10, 2024", "2024-03-10T24:00:00Z"]) {
      expect(moduleHistoryTimestampMs(value)).toBeNull()
    }
  })
})
