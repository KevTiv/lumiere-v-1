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
          { id: 1, amountTotal: 5, dateOrder: "2026-09-30T12:00:00Z" },
          { id: 2, amountTotal: 20, dateOrder: "2026-10-10T12:00:00Z" },
        ],
      },
      { startMs: Date.parse("2026-10-01T00:00:00Z"), endMs: Date.parse("2026-10-31T23:59:59Z") },
    )

    expect(result.state).toBe("ready")
    expect(result.widgets[0]).toMatchObject({ type: "kpi", data: { value: "$20" } })
    expect(storedDashboardExportGate(result)).toEqual({ allowed: true })
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
