import { describe, expect, it } from "vitest"
import { buildNavGroups } from "./navigation-catalog"
import { formRegistry } from "../forms/config/registry"
import {
  isWorkspaceFormModuleVisible,
  isWorkspaceHrefVisible,
  isWorkspaceImportTargetVisible,
  isWorkspaceSurfaceVisible,
} from "./workspace-profile"

const ids = (options: Parameters<typeof buildNavGroups>[1]) =>
  buildNavGroups((key) => key, options).flatMap((group) => group.items.map((item) => item.surfaceId))

describe("Finance Alpha global discovery", () => {
  it("keeps Finance, bounded Product/Warehouse/Fleet and support entry points and removes empty groups", () => {
    expect(ids({ workspaceProfile: "finance-alpha" }).sort()).toEqual([
      "accounting", "approvals", "calendar", "crm", "documents", "expenses", "fleet",
      "overview", "products", "purchasing", "reports", "sales", "settings", "subscriptions", "tasks", "warehouse",
    ].sort())
    expect(buildNavGroups((key) => key, { workspaceProfile: "finance-alpha" })
      .every((group) => group.items.length > 0)).toBe(true)
    expect(isWorkspaceSurfaceVisible("finance-alpha", "unknown-module")).toBe(false)
  })

  it("intersects with existing first-org admission instead of granting access", () => {
    const firstOrg = ids({ firstOrgProfile: true, isAdmin: true })
    const finance = ids({ workspaceProfile: "finance-alpha" })
    expect(ids({ workspaceProfile: "finance-alpha", firstOrgProfile: true, isAdmin: true }))
      .toEqual(firstOrg.filter((id) => finance.includes(id)))
  })

  it("hides deferred Alpha features across discovery and Settings while keeping the full profile available", () => {
    const finance = ids({ workspaceProfile: "finance-alpha" })
    for (const id of ["messages", "journal", "notebook"]) {
      expect(finance).not.toContain(id)
      expect(isWorkspaceSurfaceVisible("finance-alpha", id)).toBe(false)
      expect(isWorkspaceSurfaceVisible("full", id)).toBe(true)
    }
    expect(isWorkspaceHrefVisible("finance-alpha", "/messages/42?tab=activity")).toBe(false)
    expect(isWorkspaceHrefVisible("full", "/messages/42?tab=activity")).toBe(true)
    expect(isWorkspaceFormModuleVisible("finance-alpha", "journal")).toBe(false)
    expect(isWorkspaceFormModuleVisible("full", "journal")).toBe(true)
    expect(isWorkspaceSurfaceVisible("finance-alpha", "ai-assistant")).toBe(true)
  })

  it("filters Settings forms without removing runtime forms for linked workflows", () => {
    const modules = formRegistry.getModules()
    const visible = modules.filter((module) => isWorkspaceFormModuleVisible("finance-alpha", module.id))
    expect(visible.map((module) => module.id)).toContain("accounting")
    expect(visible.map((module) => module.id)).toContain("documents")
    expect(isWorkspaceFormModuleVisible("finance-alpha", "fleet")).toBe(true)
    expect(isWorkspaceFormModuleVisible("finance-alpha", "products")).toBe(true)
    expect(isWorkspaceFormModuleVisible("finance-alpha", "warehouse")).toBe(true)
    for (const id of ["inventory", "hr", "projects", "manufacturing", "helpdesk", "proposals", "forensic"]) {
      expect(visible.map((module) => module.id)).not.toContain(id)
      expect(formRegistry.getByModule(id).length).toBeGreaterThan(0)
    }
    expect(formRegistry.getModules()).toEqual(modules)
  })

  it("keeps Finance reference imports while hiding operational and payroll targets", () => {
    for (const key of ["product", "stock_location", "contact", "hr_employee", "hr_department", "account_move", "expense", "subscription"]) {
      expect(isWorkspaceImportTargetVisible("finance-alpha", key)).toBe(true)
    }
    for (const key of ["stock_quant", "warehouse", "task", "project", "timesheet", "hr_payslip", "hr_contract", "helpdesk_ticket", "manufacturing_order", "unknown"]) {
      expect(isWorkspaceImportTargetVisible("finance-alpha", key)).toBe(false)
    }
  })

  it("leaves full-profile consumers intact and applies href filtering only to discovery", () => {
    expect(ids({})).toContain("inventory")
    expect(ids({ workspaceProfile: "full" })).toEqual(ids({}))
    expect(isWorkspaceHrefVisible("finance-alpha", "/accounting?tab=assets")).toBe(true)
    expect(isWorkspaceHrefVisible("finance-alpha", "/inventory/transfers/1")).toBe(false)
    expect(isWorkspaceHrefVisible("full", "/inventory/transfers/1")).toBe(true)
    expect(isWorkspaceHrefVisible("finance-alpha", "/products?tab=categories")).toBe(true)
    expect(isWorkspaceHrefVisible("finance-alpha", "/warehouse?tab=stock")).toBe(true)
    expect(isWorkspaceHrefVisible("finance-alpha", "/fleet/vehicles/1?tab=service")).toBe(true)
  })

  it("keeps the bounded catalog and warehouse distinct from the full Inventory workspace", () => {
    const full = ids({ workspaceProfile: "full" })
    const alpha = ids({ workspaceProfile: "finance-alpha" })
    expect(full.filter((id) => id === "products")).toHaveLength(1)
    expect(full.filter((id) => id === "inventory")).toHaveLength(1)
    expect(full.filter((id) => id === "warehouse")).toHaveLength(1)
    expect(alpha.filter((id) => id === "products")).toHaveLength(1)
    expect(alpha).toContain("fleet")
    expect(alpha.filter((id) => id === "warehouse")).toHaveLength(1)
    expect(alpha).not.toContain("inventory")
    expect(alpha).not.toContain("map")
  })
})
