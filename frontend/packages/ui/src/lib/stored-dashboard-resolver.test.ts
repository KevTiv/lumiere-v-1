import { describe, expect, it } from "vitest"

import {
  resolveStoredDashboard,
  resolveStoredDashboardWidgets,
  storedDashboardExportGate,
} from "./stored-dashboard-resolver"

const strictBinding = (timeField: string | null, measureField: string | null) =>
  JSON.stringify({
    version: 1,
    timeField,
    measureField,
    missingTimestampPolicy: "reject",
    missingMeasurePolicy: "reject",
  })

const baseWidget: Record<string, unknown> = {
  id: 1,
  name: "Revenue",
  widgetType: "Kpi",
  model: "sale_order",
  fields: ["amount_total"],
  aggregation: "sum",
  configuration: strictBinding(null, "amount_total"),
  width: 6,
  isActive: true,
}

describe("stored dashboard resolver", () => {
  it("includes typed pre-epoch dates and excludes the exact final boundary", () => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, aggregation: "count", fields: [], configuration: strictBinding("date_order", null) }],
      [1],
      { sale_order: [
        { id: 1, date_order: { microsSinceUnixEpoch: -1000n } },
        { id: 2, date_order: { microsSinceUnixEpoch: 0n } },
        { id: 3, date_order: { microsSinceUnixEpoch: 1000n } },
      ] },
      { startMs: -1, endMs: 1 },
    )
    expect(result.state).toBe("ready")
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: "2" } })
  })

  it("emits a canonical allowlisted drill target and withholds callbacks for unadmitted fields", () => {
    const targets: unknown[] = []
    const chart = {
      ...baseWidget,
      widgetType: "Chart",
      groupBy: "state",
      chartType: "bar",
      aggregation: "count",
      fields: [],
      configuration: strictBinding(null, null),
    }
    const admitted = resolveStoredDashboard(
      [chart],
      [1],
      { sale_order: [{ id: 1, state: "Sale" }] },
      { onDrillTarget: (target) => targets.push(target) },
    )
    expect(admitted.widgets[0]).toMatchObject({ type: "bar-chart" })
    if (admitted.widgets[0]?.type !== "bar-chart") throw new Error("expected bar chart")
    admitted.widgets[0].data.onCategoryClick?.("Sale")
    expect(targets).toEqual([expect.objectContaining({
      version: 1,
      model: "sale_order",
      sourceField: "state",
      sourceValue: "Sale",
      href: "/sales?tab=orders&filter=state%3ASale",
    })])

    const blocked = resolveStoredDashboard(
      [{ ...chart, groupBy: "internalSecret" }],
      [1],
      { sale_order: [{ id: 1, internalSecret: "hidden" }] },
      { onDrillTarget: () => { throw new Error("must not navigate") } },
    )
    expect(blocked.widgets[0]).toMatchObject({ type: "bar-chart" })
    if (blocked.widgets[0]?.type !== "bar-chart") throw new Error("expected bar chart")
    expect(blocked.widgets[0].data.onCategoryClick).toBeUndefined()
  })

  it.each([
    ["malformed JSON", "{", "invalid-filter"],
    ["non-object JSON", "[]", "invalid-filter"],
    ["unsupported operator", JSON.stringify({ state: { $contains: "draft" } }), "invalid-operator"],
    ["malformed in operator", JSON.stringify({ state: { $in: "draft" } }), "invalid-filter"],
  ])("fails closed for %s", (_label, domain, code) => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, domain }],
      [1],
      { sale_order: [{ amount_total: 50, state: "draft" }] },
    )

    expect(result.state).toBe("invalid-definition")
    expect(result.widgets[0]).toMatchObject({ type: "diagnostic", data: { code } })
    expect(storedDashboardExportGate(result)).toMatchObject({ allowed: false })
    expect(resolveStoredDashboardWidgets(
      [{ ...baseWidget, domain }],
      [1],
      { sale_order: [{ amount_total: 50, state: "draft" }] },
    )[0]).toMatchObject({ type: "diagnostic", data: { code } })
  })

  it("rejects missing timestamps from bounded periods and declares partial completeness", () => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, aggregation: "count", fields: [], configuration: strictBinding("date_order", null) }],
      [1],
      {
        sale_order: [
          { id: 1, date_order: 1_700_000_000_000 },
          { id: 2 },
        ],
      },
      { startMs: 1_600_000_000_000, endMs: 1_800_000_000_000 },
    )

    expect(result.state).toBe("partial")
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "missing-timestamp", rejectedRows: 1 }))
    expect(result.widgets[0]).toMatchObject({ type: "diagnostic", data: { code: "invalid-timestamp", rejectedRows: 1 } })
  })

  it("rejects missing and invalid measures instead of coercing them to zero", () => {
    const result = resolveStoredDashboard(
      [baseWidget],
      [1],
      {
        sale_order: [
          { amount_total: 20 },
          { amount_total: null },
          { amount_total: "not-a-number" },
        ],
      },
    )

    expect(result.state).toBe("partial")
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "missing-measure", rejectedRows: 2 }))
    expect(result.widgets[0]).toMatchObject({ type: "diagnostic", data: { code: "missing-measure", rejectedRows: 2 } })
  })

  it("preserves denied and partial source state in the resolution", () => {
    const denied = resolveStoredDashboard(
      [baseWidget],
      [1],
      { sale_order: [] },
      { sourceStates: { sale_order: { status: "denied", rowCount: 0, message: "forbidden" } } },
    )
    expect(denied.state).toBe("denied")
    expect(denied.widgets).toEqual([])

    const partial = resolveStoredDashboard(
      [baseWidget],
      [1],
      { sale_order: [{ amount_total: 10 }] },
      { sourceStates: { sale_order: { status: "partial", rowCount: 1, message: "refresh failed" } } },
    )
    expect(partial.state).toBe("partial")
    expect(partial.widgets).toHaveLength(1)
  })

  it("blocks export for invalid or partial results and allows complete empty results", () => {
    const partial = resolveStoredDashboard(
      [baseWidget],
      [1],
      { sale_order: [{ amount_total: null }] },
    )
    expect(storedDashboardExportGate(partial)).toMatchObject({ allowed: false })

    const empty = resolveStoredDashboard([baseWidget], [1], { sale_order: [] })
    expect(empty.state).toBe("empty")
    expect(storedDashboardExportGate(empty)).toEqual({ allowed: true })
  })

  it("requires an explicit time binding when a dashboard date range is active", () => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, aggregation: "count", fields: [], configuration: undefined }],
      [1],
      { sale_order: [{ id: 1, dateOrder: "2026-10-10T12:00:00Z" }] },
      { startMs: Date.parse("2026-10-01T00:00:00Z"), endMs: Date.parse("2026-10-31T23:59:59Z") },
    )

    expect(result.widgets[0]).toMatchObject({
      type: "diagnostic",
      data: { code: "missing-time-field" },
    })
    expect(storedDashboardExportGate(result)).toMatchObject({ allowed: false })
  })

  it("filters and aggregates only when strict timestamp and measure bindings are complete", () => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, configuration: strictBinding("date_order", "amount_total") }],
      [1],
      {
        sale_order: [
          { id: 1, amountTotal: 5, currencyId: 1, dateOrder: "2026-09-30T12:00:00Z" },
          { id: 2, amountTotal: 20, currencyId: 1, dateOrder: "2026-10-10T12:00:00Z" },
        ],
        currency: [{ id: 1, code: "EUR", decimalPlaces: 2 }],
      },
      { startMs: Date.parse("2026-10-01T00:00:00Z"), endMs: Date.parse("2026-10-31T23:59:59Z") },
    )

    expect(result.state).toBe("ready")
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", currencyDisplay: "code" }).format(20) } })
    expect(storedDashboardExportGate(result)).toEqual({ allowed: true })
  })

  it("keeps monetary totals separate by currency ID and retains catalog precision", () => {
    const result = resolveStoredDashboard([baseWidget], [1], {
      sale_order: [
        { amountTotal: 0.1, currencyId: "9007199254740992" },
        { amountTotal: 0.2, currencyId: "9007199254740992" },
        { amountTotal: 1.001, currencyId: "9007199254740993" },
      ],
      currency: [
        { id: "9007199254740992", code: "EUR", decimalPlaces: 2 },
        { id: "9007199254740993", code: "KWD", decimalPlaces: 3 },
      ],
    })
    expect(result.state).toBe("ready")
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: {
      value: `${new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", currencyDisplay: "code" }).format(0.3)} (#9007199254740992) · ${new Intl.NumberFormat(undefined, { style: "currency", currency: "KWD", currencyDisplay: "code", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(1.001)} (#9007199254740993)`,
    } })
  })

  it("does not average across currencies or merge IDs with identical currency codes", () => {
    const result = resolveStoredDashboard([{ ...baseWidget, aggregation: "average" }], [1], {
      sale_order: [{ amount_total: 1, currency_id: 1 }, { amount_total: 3, currency_id: 1 }, { amount_total: 10, currency_id: 2 }],
      currencies: [{ id: 1, code: "EUR", decimal_places: 2 }, { id: 2, code: "EUR", decimal_places: 2 }],
    })
    const format = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", currencyDisplay: "code" }).format(value)
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: `${format(2)} (#1) · ${format(10)} (#2)` } })
  })

  it.each([
    [{ amount_total: 12.34 }, [{ id: 1, code: "EUR", decimalPlaces: 2 }]],
    [{ amount_total: 12.34, currencyId: 2 }, [{ id: 1, code: "EUR", decimalPlaces: 2 }]],
    [{ amount_total: 12.34, currencyId: 1 }, []],
    [{ amount_total: 12.34, currencyId: 1 }, [{ id: 1, code: "EUR" }]],
    [{ amount_total: 12.34, currencyId: 1 }, [{ id: 1, decimalPlaces: 2 }]],
    [{ amount_total: 1.001, currencyId: 1 }, [{ id: 1, code: "EUR", decimalPlaces: 2 }]],
    [{ amount_total: 1e-20, currencyId: 1 }, [{ id: 1, code: "EUR", decimalPlaces: 2 }]],
    [{ amount_total: Number.MAX_SAFE_INTEGER, currencyId: 1 }, [{ id: 1, code: "EUR", decimalPlaces: 2 }]],
    [{ amount_total: 1, currencyId: 9007199254740992 }, [{ id: 9007199254740992, code: "EUR", decimalPlaces: 2 }]],
    [{ amount_total: 1, currencyId: 1 }, [{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 1, code: "USD", decimalPlaces: 2 }]],
  ])("withholds money whose currency or exact amount cannot be verified", (row, currency) => {
    const result = resolveStoredDashboard([baseWidget], [1], { sale_order: [row], currency })
    expect(result.state).toBe("partial")
    expect(result.widgets[0]).toMatchObject({ type: "diagnostic", data: { code: "missing-measure" } })
    expect(storedDashboardExportGate(result).allowed).toBe(false)
  })

  it.each(["loading", "denied", "unavailable", "partial"] as const)("does not use cached currency data when its source is %s", (status) => {
    const result = resolveStoredDashboard([baseWidget], [1], {
      sale_order: [{ amount_total: 12.34, currencyId: 1 }], currency: [{ id: 1, code: "EUR", decimalPlaces: 2 }],
    }, { sourceStates: { currency: { status, rowCount: 1 } } })
    expect(result.widgets.every((widget) => widget.type !== "kpi")).toBe(true)
    expect(storedDashboardExportGate(result).allowed).toBe(false)
  })

  it("honors an explicit currency field and zero-decimal currency", () => {
    const result = resolveStoredDashboard([{ ...baseWidget,
      fields: ["net"], configuration: JSON.stringify({ ...JSON.parse(strictBinding(null, "net")), currencyField: "settlement_currency_id" }),
    }], [1], { sale_order: [{ net: 150, settlementCurrencyId: { some: 1 } }], res_currency: [{ id: 1, code: "JPY", decimalPlaces: 0 }] })
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: new Intl.NumberFormat(undefined, { style: "currency", currency: "JPY", currencyDisplay: "code" }).format(150) } })
  })

  it.each(["price_total", "price_subtotal", "balance_end_real", "unit_cost"])("preserves currency boundaries for %s", (field) => {
    const result = resolveStoredDashboard([{ ...baseWidget, model: "sale_order_line", fields: [field], configuration: strictBinding(null, field) }], [1], {
      sale_order_line: [{ [field]: 100.25, currencyId: 1 }, { [field]: 200.5, currencyId: 2 }],
      currency: [{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 2, code: "USD", decimalPlaces: 2 }],
    })
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: expect.stringContaining("EUR") } })
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: expect.stringContaining("USD") } })
    const missing = resolveStoredDashboard([{ ...baseWidget, fields: [field], configuration: strictBinding(null, field) }], [1], { sale_order: [{ [field]: 100 }] })
    expect(missing.widgets[0]).toMatchObject({ type: "diagnostic", data: { code: "missing-measure" } })
  })

  it.each([
    ["account_move_line", "debit", "EUR"],
    ["account_move_line", "credit", "EUR"],
    ["account_move_line", "balance", "EUR"],
    ["account_move_line", "amount_residual", "EUR"],
    ["account_move_line", "amount_currency", "USD"],
    ["account_move_line", "debit_currency", "USD"],
    ["account_move_line", "price_total", "USD"],
    ["account_move", "amount_total_signed", "EUR"],
    ["account_move", "amount_residual_signed", "EUR"],
    ["account_move", "amount_total_in_currency_signed", "USD"],
    ["account-move-lines", "debit", "EUR"],
    ["opportunities", "expected_revenue", "EUR"],
  ])("uses the recorded currency basis for %s.%s", (model, field, currency) => {
    const result = resolveStoredDashboard([{ ...baseWidget, model, fields: [field], configuration: strictBinding(null, field) }], [1], {
      [model]: [{ [field]: 90, currencyId: 2, companyCurrencyId: 1 }],
      currency: [{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 2, code: "USD", decimalPlaces: 2 }],
    })
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "code" }).format(90) } })
  })

  it("recognizes stock valuation through registered resource aliases", () => {
    const result = resolveStoredDashboard([{ ...baseWidget, model: "stock-quants", fields: ["value"], configuration: strictBinding(null, "value") }], [1], {
      'stock-quants': [{ value: 100, currencyId: 1 }, { value: 200, currencyId: 2 }],
      currency: [{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 2, code: "USD", decimalPlaces: 2 }],
    })
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: expect.stringContaining("EUR") } })
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: expect.stringContaining("USD") } })
  })

  it.each(["average", "avg", "min", "max"])("does not invent zero for an empty %s", (aggregation) => {
    const result = resolveStoredDashboard([{ ...baseWidget, aggregation }], [1], { sale_order: [] })
    expect(result.widgets[0]).toMatchObject({ type: "diagnostic", data: { code: "missing-measure", message: expect.stringContaining("no observations") } })
    expect(storedDashboardExportGate(result).allowed).toBe(false)
  })

  it("keeps empty sums and counts as plain zero without inventing a currency", () => {
    for (const aggregation of ["sum", "count"]) {
      const result = resolveStoredDashboard([{ ...baseWidget, aggregation }], [1], { sale_order: [] })
      expect(result.state).toBe("empty")
      expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: "0" } })
      expect(storedDashboardExportGate(result).allowed).toBe(true)
    }
    const count = resolveStoredDashboard([{ ...baseWidget, aggregation: "count" }], [1], { sale_order: [{ amount_total: 1 }, { amount_total: 2 }] })
    expect(count.widgets[0]).toMatchObject({ type: "kpi", data: { value: "2" } })
  })

  it("keeps count-only KPIs available when currency metadata is loading or denied", () => {
    for (const status of ["loading", "denied"] as const) {
      const result = resolveStoredDashboard([{ ...baseWidget, aggregation: "count" }], [1], { sale_order: [{ id: 1 }, { id: 2 }] }, {
        sourceStates: { sale_order: { status: "ready", rowCount: 2 }, currency: { status, rowCount: 0 } },
      })
      expect(result.state).toBe("ready")
      expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: "2" } })
    }
  })

  it("aggregates a large source deterministically and applies the persisted chart limit", () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => ({
      state: `bucket-${index % 250}`,
      amount_total: (index % 250) + 1,
    }))
    const result = resolveStoredDashboard(
      [{
        ...baseWidget,
        widgetType: "Chart",
        groupBy: "state",
        chartType: "bar",
        sortOrder: JSON.stringify({ value: "desc" }),
        limit: 25,
      }],
      [1],
      { sale_order: rows },
    )

    expect(result.state).toBe("ready")
    expect(result.issues).toEqual([])
    expect(result.widgets[0]).toMatchObject({
      type: "bar-chart",
      data: {
        values: expect.arrayContaining([
          { category: "bucket-249", Value: 5_000 },
          { category: "bucket-248", Value: 4_980 },
        ]),
      },
    })
    if (result.widgets[0]?.type !== "bar-chart") throw new Error("expected bar chart")
    expect(result.widgets[0].data.values).toHaveLength(25)
    expect(result.widgets[0].data.values[0]).toEqual({ category: "bucket-249", Value: 5_000 })
    expect(result.widgets[0].data.values.at(-1)).toEqual({ category: "bucket-225", Value: 4_520 })
    expect(storedDashboardExportGate(result)).toEqual({ allowed: true })
  })

  it.each([
    [{ sortOrder: "{" }, "invalid-sort"],
    [{ aggregation: "median" }, "invalid-aggregation"],
    [{ widgetType: "Chart", groupBy: "state", chartType: "radar" }, "invalid-chart-type"],
    [{ configuration: "{}" }, "invalid-binding"],
  ])("renders a diagnostic for invalid persisted definitions", (overrides, code) => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, ...overrides }],
      [1],
      { sale_order: [{ amount_total: 20, state: "sale" }] },
    )

    expect(result.state).toBe("invalid-definition")
    expect(result.widgets[0]).toMatchObject({ type: "diagnostic", data: { code } })
    expect(storedDashboardExportGate(result)).toMatchObject({ allowed: false })
  })
})
