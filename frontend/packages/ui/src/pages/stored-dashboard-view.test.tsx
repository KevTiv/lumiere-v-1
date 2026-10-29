import { act, cleanup, render, screen } from "@testing-library/react"
import { i18n } from "@lumiere/i18n"
import { forwardRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./dashboard-grid", () => ({
  DashboardGrid: forwardRef<HTMLDivElement, { testId?: string; sections?: Array<{ title?: string }> }>(function DashboardGrid(
    { testId, sections },
    ref,
  ) {
    return <div ref={ref} data-testid={testId}><span data-testid="stored-grid-title">{sections?.[0]?.title}</span>Rendered dashboard grid</div>
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
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage("en")
  })

  it("updates cached resolver messages and the unnamed-dashboard title after a language change", async () => {
    await i18n.changeLanguage("en")
    const titleKey = "ui.pages.storedDashboardView.dashboard"
    const messageKey = "common.builtIn.storedDashboardResolver.resolveStoredDashboard.theWidgetHasNoDataSource.message"
    const previousTitle = i18n.getResource("fr", "translation", titleKey)
    const previousMessage = i18n.getResource("fr", "translation", messageKey)
    i18n.addResource("fr", "translation", titleKey, "Tableau de bord français")
    i18n.addResource("fr", "translation", messageKey, "Ce widget ne possède aucune source de données.")
    try {
      render(
        <StoredDashboardView
          dashboard={{ id: 9, widgetIds: [1] }}
          widgets={[{ ...widgets[0], model: "" }]}
          dataSources={{}}
        />,
      )
      expect(screen.getByTestId("stored-grid-title").textContent).toBe("Dashboard")
      expect(screen.getByTestId("stored-dashboard-view-invalid-definition").textContent).toContain("The widget has no data source")

      await act(() => i18n.changeLanguage("fr"))

      expect(screen.getByTestId("stored-grid-title").textContent).toBe("Tableau de bord français")
      expect(screen.getByTestId("stored-dashboard-view-invalid-definition").textContent).toContain("Ce widget ne possède aucune source de données.")
    } finally {
      i18n.addResource("fr", "translation", titleKey, previousTitle)
      i18n.addResource("fr", "translation", messageKey, previousMessage)
    }
  })

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
