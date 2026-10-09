import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
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
  EntityView: ({ headerAction }: { headerAction?: ReactNode }) => <div data-testid="entity-view">{headerAction}</div>,
}))
vi.mock("../entity-views/entity-record-sheet", () => ({ EntityRecordSheet: () => null }))
vi.mock("../forms/form-modal", () => ({ FormModal: () => null }))
vi.mock("../forms/runtime-form-modal", () => ({ RuntimeFormModal: () => null }))
vi.mock("./dashboard-grid", () => ({ DashboardGrid: () => null }))
vi.mock("./dashboard-header", () => ({ DashboardHeader: () => null }))
vi.mock("../lib/export-dashboard-png", () => ({ exportDashboardToPng: vi.fn() }))

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

function renderView(opts: { permissions: PolicyRule[]; ready?: boolean }) {
  return render(
    <RBACProvider
      initialUser={user}
      initialRoles={opts.permissions.length || opts.ready === false ? [role(opts.permissions)] : []}
      initialPolicies={[]}
      permissionsReady={opts.ready}
    >
      <ModuleView config={config} data={{ orders: [] }} />
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
