import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import type { FormModalProps } from "../forms/form-modal"
import type { RuntimeFormModalProps } from "../forms/runtime-form-modal"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ModuleConfig } from "../lib/module-types"
import type { PolicyRule, Role, User } from "../lib/rbac-types"
import { RBACProvider } from "../lib/rbac-context"

vi.mock("next/navigation", () => ({
  usePathname: () => "/sales",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ companyIds: [1] }) }))
vi.mock("@lumiere/query-hooks/ai-ui-context", () => ({
  buildEntitySelection: vi.fn(),
  resolveAiEntityType: () => "sale_order",
}))
vi.mock("@lumiere/query-hooks/erp-ai-selection-context", () => ({
  useErpAiSelectionReporter: () => null,
  useErpAiSelectionState: () => ({ selection: null }),
}))
vi.mock("../lib/module-url-filters", () => ({
  useModuleUrlFilters: () => ({}),
  useClearModuleUrlFilter: () => vi.fn(),
}))
vi.mock("../entity-views/entity-view", () => ({
  EntityView: ({ headerAction, isLoading }: { headerAction?: ReactNode; isLoading?: boolean }) => <div data-testid="entity-view" data-loading={String(isLoading)}>{headerAction}</div>,
}))
vi.mock("../entity-views/entity-record-sheet", () => ({ EntityRecordSheet: () => null }))
vi.mock("../forms/form-modal", () => ({
  FormModal: ({ open, renderPreview }: FormModalProps) => open
    ? <div data-testid="create-form">{renderPreview?.({ name: "Draft order" })}</div>
    : null,
}))
vi.mock("../forms/runtime-form-modal", () => ({
  RuntimeFormModal: ({ open, renderPreview }: RuntimeFormModalProps) => open
    ? <div data-testid="create-form">{renderPreview?.({ name: "Draft order" })}</div>
    : null,
}))
vi.mock("./dashboard-grid", () => ({ DashboardGrid: () => null }))
vi.mock("./dashboard-header", () => ({ DashboardHeader: () => null }))
vi.mock("../lib/export-dashboard-png", () => ({ exportDashboardToPng: vi.fn() }))

import type { ModuleDataState } from "../lib/module-data-state"

import { ModuleView } from "./module-view"

const user: User = {
  id: "u1", email: "u@x.io", name: "U", roles: ["r1"], status: "active", createdAt: "", updatedAt: "",
}
const rule = (resource: string, action: PolicyRule["action"]): PolicyRule => ({
  id: `${resource}-${action}`, subject: "r1", resource, action, effect: "allow",
})
const role = (permissions: PolicyRule[]): Role => ({
  id: "r1", name: "Clerk", description: "", color: "blue", permissions, createdAt: "", updatedAt: "",
})

const config: ModuleConfig = {
  id: "sales",
  title: "Sales",
  tabs: [
    {
      id: "orders",
      label: "Orders",
      type: "entity",
      entityConfig: { view: { mode: "table", rowKey: "id", columns: [] } } as never,
      createForm: { title: "New order", fields: [] } as never,
      createLabel: "New Order",
      createAction: "createSaleOrder",
      createPermission: { resource: "sale_order", action: "create" },
    },
  ],
} as never

function renderView(opts: { permissions: PolicyRule[]; ready?: boolean; state?: ModuleDataState }) {
  return render(
    <RBACProvider
      initialUser={user}
      initialRoles={opts.permissions.length || opts.ready === false ? [role(opts.permissions)] : []}
      initialPolicies={[]}
      permissionsReady={opts.ready}
    >
      <ModuleView config={config} data={{ orders: [{ id: 1 }] }} dataState={opts.state ? { orders: opts.state } : undefined} />
    </RBACProvider>,
  )
}

beforeAll(() => {
  // jsdom lacks scrollIntoView, which ModuleView calls for the active tab.
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe("ModuleView header create button", () => {
  const testId = "module-create-sales-orders"

  it("shows the button when the user may create", () => {
    renderView({ permissions: [rule("sale_order", "create")] })
    expect(screen.getByTestId(testId)).toBeTruthy()
  })

  it("hides the button when the user lacks the create permission", () => {
    renderView({ permissions: [rule("sale_order", "read")] })
    expect(screen.queryByTestId(testId)).toBeNull()
  })

  it("keeps the button while permissions are still loading", () => {
    renderView({ permissions: [], ready: false })
    expect(screen.getByTestId(testId)).toBeTruthy()
  })
})


describe("ModuleView collection states", () => {
  it("suppresses stale rows and create actions when access is denied", () => {
    renderView({ permissions: [rule("sale_order", "create")], state: { status: "denied" } })
    expect(screen.getByRole("status").textContent).toContain("do not have access")
    expect(screen.queryByTestId("entity-view")).toBeNull()
    expect(screen.queryByTestId("module-create-sales-orders")).toBeNull()
  })

  it("shows retry instead of an empty list on failure", () => {
    const retry = vi.fn()
    renderView({ permissions: [], state: { status: "error", onRetry: retry } })
    expect(screen.queryByTestId("entity-view")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("labels a partial refresh while retaining cached records", () => {
    renderView({ permissions: [], state: { status: "partial" } })
    expect(screen.getByRole("alert").textContent).toContain("out of date")
    expect(screen.getByTestId("entity-view")).toBeTruthy()
  })

  it("forwards loading without showing a failure notice", () => {
    renderView({ permissions: [], state: { status: "loading" } })
    expect(screen.getByTestId("entity-view").getAttribute("data-loading")).toBe("true")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("leaves tab order and arrow navigation to the tab primitive", async () => {
    const twoTabs = { ...config, tabs: [...config.tabs, { ...config.tabs[0]!, id: "other", label: "Other" }] }
    render(<RBACProvider initialUser={user} initialRoles={[role([])]} initialPolicies={[]}>
      <ModuleView config={twoTabs} />
    </RBACProvider>)
    const tabs = screen.getAllByRole("tab")
    expect(tabs[0]!.tabIndex).toBe(0)
    expect(tabs[1]!.tabIndex).toBe(-1)
    tabs[0]!.focus()
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" })
    // Base UI's composite root moves focus in a microtask after updating the highlight.
    await waitFor(() => expect(document.activeElement).toBe(tabs[1]))
    expect(tabs.every((tab) => tab.tabIndex <= 0)).toBe(true)
  })
})

describe("ModuleView dialogs follow collection availability", () => {
  it.each([false, true])("forwards the tab preview to the create dialog (runtime=%s)", (runtime) => {
    const preview = vi.fn((_tabId, values) => <output>{String(values.name)}</output>)
    render(
      <RBACProvider initialUser={user} initialRoles={[role([rule("sale_order", "create")])]} initialPolicies={[]}>
        <ModuleView
          config={config}
          runtimeForms={runtime ? { organizationId: 1 } : undefined}
          renderCreatePreview={preview}
        />
      </RBACProvider>,
    )
    fireEvent.click(screen.getByTestId("module-create-sales-orders"))
    expect(screen.getByText("Draft order")).toBeTruthy()
    expect(preview).toHaveBeenCalledWith("orders", { name: "Draft order" }, config.tabs[0]!.createForm)
  })

  it("closes an open create form when the collection becomes denied and keeps it closed on recovery", () => {
    const view = (state: ModuleDataState) => (
      <RBACProvider initialUser={user} initialRoles={[role([rule("sale_order", "create")])]} initialPolicies={[]}>
        <ModuleView config={config} data={{ orders: [{ id: 1 }] }} dataState={{ orders: state }} />
      </RBACProvider>
    )
    const { rerender } = render(view({ status: "ready" }))
    fireEvent.click(screen.getByTestId("module-create-sales-orders"))
    expect(screen.getByTestId("create-form")).toBeTruthy()
    rerender(view({ status: "denied" }))
    expect(screen.queryByTestId("create-form")).toBeNull()
    rerender(view({ status: "ready" }))
    expect(screen.getByTestId("entity-view")).toBeTruthy()
    expect(screen.queryByTestId("create-form")).toBeNull()
  })
})
