import { describe, expect, it } from "vitest"

import { resolveStoredDashboardDrillTarget } from "./stored-dashboard-drill-target"

describe("stored dashboard drill target contract", () => {
  it("maps an admitted report category to its canonical module filter", () => {
    expect(resolveStoredDashboardDrillTarget("sale_order", "state", "Sale")).toEqual({
      version: 1,
      model: "sale_order",
      sourceField: "state",
      sourceValue: "Sale",
      moduleId: "sales",
      tabId: "orders",
      href: "/sales?tab=orders&filter=state%3ASale",
    })
  })

  it("normalizes camel fields but rejects unadmitted models, fields and values", () => {
    expect(resolveStoredDashboardDrillTarget("account_move", "moveType", "Entry")?.sourceField)
      .toBe("move_type")
    expect(resolveStoredDashboardDrillTarget("secret_table", "state", "ready")).toBeNull()
    expect(resolveStoredDashboardDrillTarget("sale_order", "metadata", "x")).toBeNull()
    expect(resolveStoredDashboardDrillTarget("sale_order", "state", "bad\nvalue")).toBeNull()
  })
})
