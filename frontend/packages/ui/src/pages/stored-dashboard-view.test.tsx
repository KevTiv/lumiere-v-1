import { cleanup, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./dashboard-grid", () => ({
  DashboardGrid: forwardRef<HTMLDivElement, { testId?: string }>(function DashboardGrid(
    { testId },
    ref,
  ) {
    return <div ref={ref} data-testid={testId}>Rendered dashboard grid</div>
  }),
}))

import { StoredDashboardView } from "./stored-dashboard-view"

const dashboard = { id: 9, name: "Sales", widgetIds: [1] }
const widgets = [{
  id: 1,
  name: "Orders",
  widgetType: "Kpi",
  model: "sale_order",
  fields: [],
  aggregation: "count",
  width: 6,
  isActive: true,
}]

describe("StoredDashboardView", () => {
  afterEach(() => cleanup())

  it("renders an explicit denied state instead of an empty dashboard", () => {
    render(
      <StoredDashboardView
        dashboard={dashboard}
        widgets={widgets}
        dataSources={{ sale_order: [] }}
        sourceStates={{ sale_order: { status: "denied", rowCount: 0, message: "Access denied." } }}
      />,
    )

    expect(screen.getByTestId("stored-dashboard-view-denied").textContent).toContain("Access denied")
    expect(screen.queryByText("No widgets configured for this dashboard.")).toBeNull()
  })

  it("renders available rows with an explicit partial-state warning", () => {
    render(
      <StoredDashboardView
        dashboard={dashboard}
        widgets={widgets}
        dataSources={{ sale_order: [{ id: 1 }] }}
        sourceStates={{ sale_order: { status: "partial", rowCount: 1, message: "Refresh failed." } }}
      />,
    )

    expect(screen.getByTestId("stored-dashboard-view-partial").textContent).toContain("Refresh failed")
    expect(screen.getByTestId("stored-dashboard-view-grid")).toBeTruthy()
  })

  it("labels a successfully loaded empty source", () => {
    render(
      <StoredDashboardView
        dashboard={dashboard}
        widgets={widgets}
        dataSources={{ sale_order: [] }}
        sourceStates={{ sale_order: { status: "empty", rowCount: 0 } }}
      />,
    )

    expect(screen.getByTestId("stored-dashboard-view-empty")).toBeTruthy()
    expect(screen.getByTestId("stored-dashboard-view-grid")).toBeTruthy()
  })
})
