import React from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModuleConfig } from "../lib/module-types"
import { chooseSelectValue } from "../components/select-test-utils"

const route = vi.hoisted(() => ({ query: "tab=fixed-assets&filter=id%3A7", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/accounting",
  useRouter: () => ({ replace: route.replace }),
  useSearchParams: () => new URLSearchParams(route.query),
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ companyIds: [1] }) }))
vi.mock("@lumiere/query-hooks/ai-ui-context", () => ({
  buildEntitySelection: vi.fn(),
  resolveAiEntityType: vi.fn(),
}))
vi.mock("@lumiere/query-hooks/erp-ai-selection-context", () => ({
  useErpAiSelectionReporter: () => null,
  useErpAiSelectionState: () => ({ selection: null }),
}))
vi.mock("../lib/rbac-context", () => ({
  useRBAC: () => ({ checkPermission: () => ({ allowed: true }), permissionsReady: true }),
}))
vi.mock("../entity-views/entity-view", () => ({ EntityView: () => null }))
vi.mock("../entity-views/entity-record-sheet", () => ({ EntityRecordSheet: () => null }))
vi.mock("../forms/form-modal", () => ({ FormModal: () => null }))
vi.mock("../forms/runtime-form-modal", () => ({ RuntimeFormModal: () => null }))
vi.mock("./dashboard-grid", () => ({ DashboardGrid: () => null }))
vi.mock("./dashboard-header", () => ({ DashboardHeader: () => null }))
vi.mock("../lib/export-dashboard-png", () => ({ exportDashboardToPng: vi.fn() }))

import { ModuleView } from "./module-view"
import { useModuleTab } from "../../../../web/hooks/use-module-tab"

const config: ModuleConfig = {
  id: "accounting",
  title: "Accounting",
  defaultTab: "dashboard",
  tabNavigation: "areas",
  tabGroups: [
    { label: "Receivables", tabIds: ["invoices", "credit-control"] },
    { label: "Assets", tabIds: ["fixed-assets", "amortization"] },
    { label: "Setup", tabIds: ["accounts", "taxes"] },
  ],
  tabs: [
    "dashboard",
    "invoices",
    "credit-control",
    "accounts",
    "taxes",
    "fixed-assets",
    "amortization",
  ].map((id) => ({ id, label: id, type: "custom", customContent: <p>{id} content</p> })),
}

function ControlledView() {
  const tabs = useModuleTab(
    "dashboard",
    config.tabs.map((tab) => tab.id),
  )
  return (
    <ModuleView config={config} activeTab={tabs.activeTab} onActiveTabChange={tabs.setActiveTab} />
  )
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
beforeEach(() => {
  route.query = "tab=fixed-assets&filter=id%3A7"
  route.replace.mockReset()
})
afterEach(cleanup)

describe("module task-area navigation", () => {
  it("mounts only the active area's triggers and derives the complete tab-to-area map", () => {
    render(<ModuleView config={config} />)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "fixed-assets",
      "amortization",
    ])
    expect(screen.queryByTestId("module-tab-accounting-invoices")).toBeNull()
    const trigger = screen.getByTestId("module-area-accounting")
    expect(JSON.parse(trigger.getAttribute("data-tab-areas")!)).toEqual({
      dashboard: "dashboard",
      invoices: "invoices",
      "credit-control": "invoices",
      "fixed-assets": "fixed-assets",
      amortization: "fixed-assets",
      accounts: "accounts",
      taxes: "accounts",
    })
    chooseSelectValue(trigger, "invoices")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "invoices",
      "credit-control",
    ])
    expect(screen.queryByTestId("module-tab-accounting-fixed-assets")).toBeNull()
    expect(route.replace).toHaveBeenCalledWith("/accounting?tab=invoices", { scroll: false })
  })

  it("keeps arrow, Home, and End focus within the two mounted area tabs", async () => {
    render(<ModuleView config={config} />)
    const [first, last] = screen.getAllByRole("tab")
    first!.focus()
    fireEvent.keyDown(first!, { key: "End" })
    await waitFor(() => expect(document.activeElement).toBe(last))
    fireEvent.keyDown(last!, { key: "ArrowRight" })
    await waitFor(() => expect(document.activeElement).toBe(first))
    fireEvent.keyDown(first!, { key: "ArrowRight" })
    await waitFor(() => expect(document.activeElement).toBe(last))
    fireEvent.keyDown(last!, { key: "Home" })
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(screen.getAllByRole("tab")).toHaveLength(2)
  })

  it("uses one canonical controlled URL update and clears all old-tab filters", () => {
    route.query = "tab=fixed-assets&filter=id%3A7&filter=state%3AOpen&search=keep"
    render(<ControlledView />)
    chooseSelectValue(screen.getByTestId("module-area-accounting"), "invoices")
    expect(route.replace).toHaveBeenCalledTimes(1)
    const url = new URL(route.replace.mock.calls[0]![0], "https://example.test")
    expect(url.pathname).toBe("/accounting")
    expect(url.searchParams.get("tab")).toBe("invoices")
    expect(url.searchParams.getAll("filter")).toEqual([])
    expect(url.searchParams.get("search")).toBe("keep")
  })

  it("preserves record filters for same-tab refocus", () => {
    const hook = renderHook(() =>
      useModuleTab(
        "dashboard",
        config.tabs.map((tab) => tab.id),
      ),
    )
    act(() => hook.result.current.setActiveTab("fixed-assets"))
    expect(route.replace).toHaveBeenCalledWith("/accounting?tab=fixed-assets&filter=id%3A7", {
      scroll: false,
    })
  })

  it("clears tab and record filters when the canonical URL setter selects the default tab", () => {
    const hook = renderHook(() =>
      useModuleTab(
        "dashboard",
        config.tabs.map((tab) => tab.id),
      ),
    )
    act(() => hook.result.current.setActiveTab("dashboard"))
    expect(route.replace).toHaveBeenCalledWith("/accounting", { scroll: false })
  })
})
