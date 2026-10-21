import { describe, expect, it } from "vitest"
import type { ModuleTab, ModuleWorkspaceNav } from "./module-types"
import { moduleTabHref, moduleWorkspaceNavigation, resolveWorkspaceNavigation } from "./workspace-navigation"

const tab = (id: string): ModuleTab => ({ id, label: id, type: "custom" })
const config: ModuleWorkspaceNav = {
  workspaces: [
    { id: "overview", label: "Overview", tabIds: ["dashboard"] },
    { id: "ledger", label: "Ledger", tabIds: ["journal-entries", "move-lines"] },
  ],
  overflow: [{ id: "setup", label: "Configuration", tabIds: ["taxes"] }],
}

describe("workspace navigation", () => {
  it("uses the same workspace model when a module only supplies legacy tab groups", () => {
    const tabs = ["dashboard", "orders", "lines", "vendors"].map(tab)
    const nav = moduleWorkspaceNavigation({ id: "purchasing", title: "Purchasing", tabs,
      tabGroups: [{ label: "Orders", tabIds: ["orders", "lines", "not-installed"] }],
    })
    const result = resolveWorkspaceNavigation(tabs, nav)
    expect(result.workspaces.map((group) => group.tabs.map((item) => item.id))).toEqual([["dashboard"], ["orders", "lines"], ["vendors"]])
  })

  it("bounds uncurated navigation without dropping any destinations", () => {
    const tabs = Array.from({ length: 20 }, (_, index) => tab(`tab-${index}`))
    const result = resolveWorkspaceNavigation(tabs, moduleWorkspaceNavigation({ id: "future", title: "Future", tabs }))
    expect(result.workspaces).toHaveLength(6)
    expect([...result.workspaces, ...result.overflow].flatMap((group) => group.tabs)).toEqual(tabs)
  })

  it("keeps curated configuration authoritative", () => {
    expect(moduleWorkspaceNavigation({ id: "accounting", title: "Accounting", tabs: [], workspaceNav: config })).toBe(config)
  })

  it("includes runtime additions and keeps every canonical tab reachable exactly once", () => {
    const tabs = ["dashboard", "journal-entries", "move-lines", "taxes", "future-runtime-tab"].map(tab)
    const result = resolveWorkspaceNavigation(tabs, config)
    expect(result.workspaces[1]?.tabs.map((item) => item.id)).toEqual(["journal-entries", "move-lines"])
    const reachable = [...result.workspaces, ...result.overflow].flatMap((group) => group.tabs.map((item) => item.id))
    expect(reachable).toEqual(tabs.map((item) => item.id))
    expect(new Set(reachable).size).toBe(tabs.length)
  })

  it("omits absent tabs and empty workspaces without inventing destinations", () => {
    const result = resolveWorkspaceNavigation([tab("dashboard"), tab("taxes")], config)
    expect(result.workspaces.map((group) => group.id)).toEqual(["overview"])
    expect(result.overflow[0]?.tabs.map((item) => item.id)).toEqual(["taxes"])
  })

  it("deduplicates tabs declared in overlapping groups", () => {
    const result = resolveWorkspaceNavigation([tab("dashboard")], {
      workspaces: [{ id: "first", label: "First", tabIds: ["dashboard", "dashboard"] }],
      overflow: [{ id: "duplicate", label: "Duplicate", tabIds: ["dashboard"] }],
    })
    expect(result.workspaces[0]?.tabs).toHaveLength(1)
    expect(result.overflow).toEqual([])
  })
})

describe("canonical tab links", () => {
  it("preserves company context and clears every previous collection filter", () => {
    const href = moduleTabHref("/accounting", "company=2&tab=invoices&filter=state:draft&filter=partner:4&highlight=23", "move-lines", "dashboard")
    expect(href).toBe("/accounting?company=2&tab=move-lines")
  })

  it("uses the existing dashboard URL when returning to overview", () => {
    expect(moduleTabHref("/accounting", "tab=taxes&filter=active:true", "dashboard", "dashboard")).toBe("/accounting")
  })
})
