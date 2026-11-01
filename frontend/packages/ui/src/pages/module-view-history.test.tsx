import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModuleConfig } from "../lib/module-types"

const route = vi.hoisted(() => ({ query: "", push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/sales",
  useRouter: () => ({ push: route.push, replace: route.replace }),
  useSearchParams: () => new URLSearchParams(route.query),
}))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ companyIds: [1] }) }))
vi.mock("@lumiere/query-hooks/ai-ui-context", () => ({ buildEntitySelection: vi.fn(), resolveAiEntityType: vi.fn() }))
vi.mock("@lumiere/query-hooks/erp-ai-selection-context", () => ({
  useErpAiSelectionReporter: () => null,
  useErpAiSelectionState: () => ({ selection: null }),
}))
vi.mock("../lib/rbac-context", () => ({
  useRBAC: () => ({ checkPermission: () => ({ allowed: true }), permissionsReady: true }),
}))
vi.mock("../entity-views/entity-view", () => ({
  EntityView: ({ data, initialFilters }: { data: Record<string, unknown>[]; initialFilters?: Record<string, string> }) => <div data-testid="history-table" data-filters={JSON.stringify(initialFilters)}>
    {data.map((row) => <span key={String(row.id)} data-testid="history-row">{String(row.id)}</span>)}
  </div>,
}))
vi.mock("../entity-views/entity-record-sheet", () => ({ EntityRecordSheet: () => null }))
vi.mock("../forms/form-modal", () => ({ FormModal: () => null }))
vi.mock("../forms/runtime-form-modal", () => ({ RuntimeFormModal: () => null }))
vi.mock("./dashboard-grid", () => ({ DashboardGrid: () => null }))
vi.mock("./dashboard-header", () => ({ DashboardHeader: () => null }))
vi.mock("../lib/export-dashboard-png", () => ({ exportDashboardToPng: vi.fn() }))

import { ModuleView } from "./module-view"

const config: ModuleConfig = {
  id: "sales", title: "Sales", defaultTab: "orders",
  tabs: [
    {
      id: "orders", label: "Orders", type: "entity",
      entityConfig: { view: { mode: "table", rowKey: "id", columns: [] } } as never,
      entityAltView: { label: "Board", tableLabel: "Table", content: <div>Unfiltered alternate board</div> },
    },
    {
      id: "customers", label: "Customers", type: "entity",
      entityConfig: { view: { mode: "table", rowKey: "id", columns: [] } } as never,
    },
  ],
}
const orders = [
  { id: "before", dateOrder: "2024-03-10T04:59:59.999Z", state: "open" },
  { id: "start", dateOrder: "2024-03-10T05:00:00.000Z", state: "open" },
  { id: "last", dateOrder: "2024-03-11T03:59:59.999Z", state: "closed" },
  { id: "end", dateOrder: "2024-03-11T04:00:00.000Z", state: "open" },
  { id: "undated", dateOrder: null, state: "open" },
]
const visibleIds = () => screen.queryAllByTestId("history-row").map((row) => row.textContent)

beforeAll(() => { Element.prototype.scrollIntoView ??= vi.fn() })
beforeEach(() => {
  route.query = "tab=orders&period=custom:2024-03-10:2024-03-10&periodTimeZone=America%2FNew_York&filter=currencyId%3A1&filter=companyId%3A7"
  route.push.mockReset()
  route.replace.mockReset()
})
afterEach(cleanup)

describe("ModuleView history drilldown", () => {
  it("filters the admitted list in the linked zone before applying a KPI predicate", () => {
    const matches = vi.fn((row: Record<string, unknown>) => row.state === "open")
    render(<ModuleView config={config} data={{ orders }} kpiStrips={{ orders: {
      tiles: [{ key: "open", label: "Open", value: 4, matches }],
    } }} />)
    expect(visibleIds()).toEqual(["start", "last"])
    expect(screen.queryByText("Unfiltered alternate board")).toBeNull()
    expect(screen.getByTestId("module-history-filter").textContent).toContain("2024-03-10")
    expect(screen.getByTestId("module-history-filter").textContent).toContain("America/New_York")
    expect(JSON.parse(screen.getByTestId("history-table").getAttribute("data-filters")!)).toEqual({ currencyId: "1", companyId: "7" })
    fireEvent.click(screen.getByTestId("kpi-tile-open"))
    expect(visibleIds()).toEqual(["start"])
    expect(matches.mock.calls.map(([row]) => row.id)).toEqual(["start", "last"])
  })

  it("makes invalid links visible and clears only date controls while retaining other filters", () => {
    route.query = "tab=orders&period=custom:2025-01-01:2024-01-01&periodTimeZone=UTC&filter=currencyId%3A1&filter=companyId%3A7&search=keep"
    render(<ModuleView config={config} data={{ orders }} />)
    expect(visibleIds()).toEqual([])
    expect(screen.getByRole("alert").textContent).toContain("invalid date range")
    fireEvent.click(screen.getByRole("button", { name: "Clear date range" }))
    expect(route.replace).toHaveBeenCalledOnce()
    const next = new URL(route.replace.mock.calls[0]![0], "https://example.test")
    expect(next.searchParams.get("period")).toBeNull()
    expect(next.searchParams.get("periodTimeZone")).toBeNull()
    expect(next.searchParams.get("tab")).toBe("orders")
    expect(next.searchParams.getAll("filter")).toEqual(["currencyId:1", "companyId:7"])
    expect(next.searchParams.get("search")).toBe("keep")
  })

  it("does not apply a business date from another tab to the active collection", () => {
    route.query = "tab=customers&period=custom:2024-03-10:2024-03-10&periodTimeZone=UTC"
    render(<ModuleView config={config} data={{ customers: [{ id: "customer", dateOrder: null }] }} />)
    expect(visibleIds()).toEqual(["customer"])
    expect(screen.queryByTestId("module-history-filter")).toBeNull()
  })
})
