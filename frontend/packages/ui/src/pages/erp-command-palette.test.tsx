import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspaceProfileProvider } from "../lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible, type WorkspaceProfile } from "../lib/workspace-profile"
import { ErpCommandPalette } from "./erp-command-palette"

const push = vi.fn()
const hookCalls = vi.hoisted(() => ({ names: [] as string[] }))
const rbac = vi.hoisted(() => ({ denied: new Set<string>() }))
const navigation = vi.hoisted(() => ({ hidden: new Set<string>() }))
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
  buildNavGroups: (_t: unknown, options?: { workspaceProfile?: WorkspaceProfile }) => [
    {
      label: "Modules",
      items: [
        { surfaceId: "sales", label: "Sales", href: "/sales", icon: () => null, resource: "module:sales" },
        { surfaceId: "crm", label: "CRM", href: "/crm", icon: () => null, resource: "module:crm" },
        { surfaceId: "products", label: "Products", href: "/products", icon: () => null, resource: "module:inventory" },
        { surfaceId: "warehouse", label: "Warehouse", href: "/warehouse", icon: () => null, resource: "module:inventory" },
        { surfaceId: "inventory", label: "Inventory", href: "/inventory", icon: () => null, resource: "module:inventory" },
        { surfaceId: "fleet", label: "Fleet", href: "/fleet", icon: () => null, resource: "module:fleet" },
        { surfaceId: "purchasing", label: "Purchasing", href: "/purchasing", icon: () => null, resource: "module:purchasing" },
        { surfaceId: "messages", label: "Messages", href: "/messages", icon: () => null, resource: "module:messages" },
      ],
    },
  ].map((group) => ({ ...group, items: group.items.filter((item) => !navigation.hidden.has(item.surfaceId) && isWorkspaceSurfaceVisible(options?.workspaceProfile ?? "full", item.surfaceId)) })),
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
  navigation.hidden.clear()
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
    stock_picking: [{ id: 8, name: "ACME-TRANSFER" }],
    fleet_vehicle: [{ id: 71, name: "Acme delivery van", license_plate: "RAG 281 C" }],
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
  it.each(["finance-alpha", "full"] as const)("keeps deferred feature actions aligned with the %s profile", (profile) => {
    const onOpenNotebook = vi.fn()
    const onOpenJournal = vi.fn()
    const onOpenAIChat = vi.fn()
    render(<WorkspaceProfileProvider value={profile}><ErpCommandPalette open onOpenNotebook={onOpenNotebook} onOpenJournal={onOpenJournal} onOpenAIChat={onOpenAIChat} /></WorkspaceProfileProvider>)
    expect(screen.getByRole("option", { name: "nav.aiAssistant" })).toBeTruthy()
    if (profile === "finance-alpha") {
      expect(screen.queryByRole("option", { name: "Messages" })).toBeNull()
      expect(screen.queryByRole("option", { name: "nav.notebook" })).toBeNull()
      expect(screen.queryByRole("option", { name: "nav.journal" })).toBeNull()
    } else {
      expect(screen.getByRole("option", { name: "Messages" })).toBeTruthy()
      fireEvent.click(screen.getByRole("option", { name: "nav.notebook" }))
      expect(onOpenNotebook).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole("option", { name: "nav.journal" }))
      expect(onOpenJournal).toHaveBeenCalledOnce()
    }
  })

  it("does not query or offer hidden modules under the Finance Alpha provider", () => {
    render(<WorkspaceProfileProvider value="finance-alpha"><ErpCommandPalette recordHref={recordHref} /></WorkspaceProfileProvider>)
    act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }) })
    expect(screen.queryByRole("option", { name: "Inventory" })).toBeNull()
    type("acme")
    expect(hookCalls.names).toContain("sale_order")
    expect(hookCalls.names).toContain("product")
    expect(hookCalls.names).toContain("fleet_vehicle")
    expect(hookCalls.names).toContain("stock_picking")
    expect(screen.getByTestId("erp-command-palette-record-product-5")).toBeTruthy()
    expect(screen.getByTestId("erp-command-palette-record-fleet_vehicle-71")).toBeTruthy()
    expect(screen.getByTestId("erp-command-palette-record-stock_picking-8")).toBeTruthy()
    expect(screen.getByTestId("erp-command-palette-record-sale_order-1")).toBeTruthy()
    fireEvent.click(screen.getByTestId("erp-command-palette-record-product-5"))
    expect(push).toHaveBeenCalledWith("/products?tab=products&filter=id%3A5")
  })

  it("does not discover warehouse records through Products' shared inventory permission", () => {
    navigation.hidden.add("warehouse")
    render(<WorkspaceProfileProvider value="finance-alpha"><ErpCommandPalette open recordHref={recordHref} /></WorkspaceProfileProvider>)
    type("acme")
    expect(hookCalls.names).toContain("product")
    expect(hookCalls.names).not.toContain("stock_picking")
    expect(screen.queryByTestId("erp-command-palette-record-stock_picking-8")).toBeNull()
  })

  it("uses Warehouse for transfer results without a canonical detail URL", () => {
    render(<WorkspaceProfileProvider value="finance-alpha"><ErpCommandPalette open recordHref={recordHref} /></WorkspaceProfileProvider>)
    type("transfer")
    fireEvent.click(screen.getByTestId("erp-command-palette-record-stock_picking-8"))
    expect(push).toHaveBeenCalledWith("/warehouse?tab=transfers&filter=id%3A8")
  })

  it("opens from the workspace search control and keeps shortcut and navigation state synchronized", () => {
    function WorkspaceSearch() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Search workspace</button>
        <output data-testid="palette-open">{String(open)}</output>
        <ErpCommandPalette open={open} onOpenChange={setOpen} recordHref={recordHref} />
      </>
    }
    render(<WorkspaceSearch />)
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }))
    const dialog = screen.getByRole("dialog", {
      name: "Command Palette",
      description: "Search modules, quick actions and records",
    })
    expect(within(dialog).getByRole("heading", { name: "Command Palette" })).toBeTruthy()
    expect(screen.getByRole("combobox")).toBeTruthy()
    type("so00")
    fireEvent.click(screen.getByTestId("erp-command-palette-record-sale_order-1"))
    expect(push).toHaveBeenCalledWith("/sales/orders/1")
    expect(screen.getByTestId("palette-open").textContent).toBe("false")
    fireEvent.keyDown(window, { key: "k", metaKey: true })
    expect(screen.getByTestId("palette-open").textContent).toBe("true")
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByTestId("palette-open").textContent).toBe("false")
  })

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
