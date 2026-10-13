import { describe, expect, it } from "vitest"

import {
  resolveStoredDashboard,
  resolveStoredDashboardWidgets,
  storedDashboardExportGate,
} from "./stored-dashboard-resolver"

const baseWidget: Record<string, unknown> = {
  id: 1,
  name: "Revenue",
  widgetType: "Kpi",
  model: "sale_order",
  fields: ["amount_total"],
  aggregation: "sum",
  width: 6,
  isActive: true,
}

describe("stored dashboard resolver", () => {
  it.each([
    ["malformed JSON", "{", "not valid JSON"],
    ["non-object JSON", "[]", "must be a JSON object"],
    ["unsupported operator", JSON.stringify({ state: { $contains: "draft" } }), "not supported"],
    ["malformed in operator", JSON.stringify({ state: { $in: "draft" } }), "must use an array"],
  ])("fails closed for %s", (_label, domain, message) => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, domain }],
      [1],
      { sale_order: [{ amount_total: 50, state: "draft" }] },
    )

    expect(result.state).toBe("invalid-definition")
    expect(result.widgets).toEqual([])
    expect(result.issues[0]?.message).toContain(message)
    expect(resolveStoredDashboardWidgets(
      [{ ...baseWidget, domain }],
      [1],
      { sale_order: [{ amount_total: 50, state: "draft" }] },
    )).toEqual([])
  })

  it("excludes missing timestamps from bounded periods and declares partial completeness", () => {
    const result = resolveStoredDashboard(
      [{ ...baseWidget, aggregation: "count", fields: [] }],
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
    expect(result.widgets[0]).toMatchObject({ data: { value: "1" } })
  })

  it("excludes missing and invalid measures instead of coercing them to zero", () => {
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
    expect(result.widgets[0]).toMatchObject({ data: { value: "$20" } })
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
})
