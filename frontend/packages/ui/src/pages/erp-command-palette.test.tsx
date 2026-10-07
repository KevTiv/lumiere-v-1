import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ErpCommandPalette } from "./erp-command-palette"

const push = vi.fn()
const hookCalls = vi.hoisted(() => ({ names: [] as string[] }))
const rbac = vi.hoisted(() => ({ denied: new Set<string>() }))
const data = vi.hoisted(() => ({
  loading: false,
  failed: new Set<string>(),
  rows: {} as Record<string, unknown[]>,
}))

function rowsHook(name: string) {
  return () => {
    hookCalls.names.push(name)
    return { data: data.rows[name] ?? [], isLoading: data.loading, isError: data.failed.has(name) }
  }
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@lumiere/i18n", () => {
  const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key
  const value = { t }
  return { useTranslation: () => value }
})
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ organizationId: 7 }) }))
vi.mock("@/lib/rbac-context", () => ({
  useRBAC: () => ({
    isAdmin: () => false,
    checkPermission: (resource: string) => ({ allowed: !rbac.denied.has(resource) }),
  }),
}))
vi.mock("../lib/navigation-catalog", () => ({
  buildNavGroups: () => [
    {
      label: "Modules",
      items: [
        { surfaceId: "sales", label: "Sales", href: "/sales", icon: () => null, resource: "module:sales" },
        { surfaceId: "crm", label: "CRM", href: "/crm", icon: () => null, resource: "module:crm" },
        { surfaceId: "inventory", label: "Inventory", href: "/inventory", icon: () => null, resource: "module:inventory" },
        { surfaceId: "purchasing", label: "Purchasing", href: "/purchasing", icon: () => null, resource: "module:purchasing" },
      ],
    },
  ],
}))
vi.mock("@lumiere/query-hooks/hooks/crm", () => ({ useContacts: rowsHook("contact") }))
vi.mock("@lumiere/query-hooks/hooks/sales", () => ({ useSaleOrders: rowsHook("sale_order") }))
vi.mock("@lumiere/query-hooks/hooks/purchasing", () => ({ usePurchaseOrders: rowsHook("purchase_order") }))
vi.mock("@lumiere/query-hooks/hooks/accounting", () => ({ useAccountMoves: rowsHook("account_move") }))
vi.mock("@lumiere/query-hooks/hooks/inventory", () => ({
  useProducts: rowsHook("product"),
  useStockPickings: rowsHook("stock_picking"),
}))
vi.mock("@lumiere/query-hooks/hooks/subscriptions", () => ({ useSubscriptions: rowsHook("subscription") }))
vi.mock("@lumiere/query-hooks/hooks/documents", () => ({ useDocuments: rowsHook("document") }))
vi.mock("@lumiere/query-hooks/hooks/fleet", () => ({ useFleetVehicles: rowsHook("fleet_vehicle") }))
vi.mock("@lumiere/query-hooks/hooks/calendar", () => ({ useCalendarEvents: rowsHook("calendar_event") }))
vi.mock("@lumiere/query-hooks/hooks/pos", () => ({ usePosSessions: rowsHook("pos_session") }))
vi.mock("@lumiere/query-hooks/hooks/manufacturing", () => ({ useMrpProductions: rowsHook("mrp_production") }))
vi.mock("@lumiere/query-hooks/hooks/expenses", () => ({ useExpenseSheets: rowsHook("hr_expense_sheet") }))
vi.mock("@lumiere/query-hooks/hooks/projects", () => ({ useProjects: rowsHook("project_project") }))

const recordHref = (model: string, id: string) => (model === "sale_order" ? `/sales/orders/${id}` : undefined)

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO)
  Element.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  push.mockReset()
  hookCalls.names.length = 0
  rbac.denied.clear()
  data.loading = false
  data.failed.clear()
  data.rows = {
    sale_order: [
      { id: 1, name: "SO001", partnerId: 10 },
      { id: 2, name: "SO002", partnerId: 11 },
    ],
    contact: [
      { id: 10, displayName: "Zoé Acme", email: "zoe@acme.test" },
      { id: 11, displayName: "Bob" },
    ],
    product: [{ id: 5, name: "Acme Widget", defaultCode: "W-1" }],
    purchase_order: [{ id: 9, name: "PO-ACME" }],
  }
})

afterEach(() => cleanup())

function openPalette() {
  render(<ErpCommandPalette recordHref={recordHref} />)
  act(() => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  })
}

function type(text: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } })
}

describe("ErpCommandPalette records", () => {
  it("reports failed reads instead of claiming no results or displaying stale rows", () => {
    data.failed.add("sale_order")
    openPalette()
    type("so00")
    expect(screen.getByTestId("erp-command-palette-records-error")).toBeTruthy()
    expect(screen.queryByTestId("erp-command-palette-record-sale_order-1")).toBeNull()
    expect(screen.queryByText("No results found.")).toBeNull()
  })

  it("keeps healthy model results when another model fails", () => {
    data.failed.add("purchase_order")
    openPalette()
    type("acme")
    expect(screen.getByTestId("erp-command-palette-records-error")).toBeTruthy()
    expect(screen.getByTestId("erp-command-palette-record-product-5")).toBeTruthy()
  })

  it("does not search other records using stale partner names after contacts fail", () => {
    data.failed.add("contact")
    openPalette()
    type("bob")
    expect(screen.queryByTestId("erp-command-palette-record-sale_order-2")).toBeNull()
    expect(screen.getByTestId("erp-command-palette-records-error")).toBeTruthy()
  })

  it("reads no record table while closed or with a one-character query", () => {
    render(<ErpCommandPalette recordHref={recordHref} />)
    expect(hookCalls.names).toEqual([])
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    })
    expect(screen.getByRole("combobox")).toBeTruthy()
    type("a")
    expect(hookCalls.names).toEqual([])
  })

  it("groups matches by model and navigates to the record page", () => {
    openPalette()
    type("so00")
    expect(screen.getByText("Sales orders")).toBeTruthy()
    fireEvent.click(screen.getByTestId("erp-command-palette-record-sale_order-1"))
    expect(push).toHaveBeenCalledWith("/sales/orders/1")
  })

  it("finds contacts by accent-free email/name and uses the tab filter for models without a page", () => {
    openPalette()
    type("zoe")
    fireEvent.click(screen.getByTestId("erp-command-palette-record-contact-10"))
    expect(push).toHaveBeenCalledWith("/crm?tab=contacts&filter=id%3A10")
  })

  it("matches a record by its partner name", () => {
    openPalette()
    type("bob")
    expect(screen.getByTestId("erp-command-palette-record-sale_order-2")).toBeTruthy()
    expect(screen.queryByTestId("erp-command-palette-record-sale_order-1")).toBeNull()
  })

  it("skips models the user cannot read", () => {
    rbac.denied.add("module:purchasing")
    openPalette()
    type("acme")
    expect(screen.getByTestId("erp-command-palette-record-product-5")).toBeTruthy()
    expect(screen.queryByTestId("erp-command-palette-records-purchase_order")).toBeNull()
    expect(hookCalls.names).not.toContain("purchase_order")
  })

  it("caps each model at five results", () => {
    data.rows.sale_order = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `SO-${i + 1}` }))
    openPalette()
    type("so-")
    expect(screen.getAllByTestId(/^erp-command-palette-record-sale_order-/)).toHaveLength(5)
  })

  it("shows a loading state, then the empty state", () => {
    data.loading = true
    data.rows = {}
    openPalette()
    type("nomatch")
    expect(screen.getByTestId("erp-command-palette-records-loading")).toBeTruthy()
    expect(screen.queryByText("No results found.")).toBeNull()
    cleanup()
    data.loading = false
    openPalette()
    type("nomatch")
    expect(screen.queryByTestId("erp-command-palette-records-loading")).toBeNull()
    expect(screen.getByText("No results found.")).toBeTruthy()
  })

  it("still lists modules when the query is short", () => {
    openPalette()
    expect(screen.getByText("Sales")).toBeTruthy()
  })
})
