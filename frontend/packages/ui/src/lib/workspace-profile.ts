/** UI discovery only. Destination authorization and first-org admission remain separate. */
export type WorkspaceProfile = "full" | "finance-alpha"

const FINANCE_MODULES = new Set([
  "accounting", "sales", "crm", "purchasing", "reports", "subscriptions", "expenses",
])
// Bounded workspaces alongside Finance; the broad legacy Inventory route stays link-only.
const ALPHA_MODULES = new Set(["products", "warehouse", "fleet"])
const FINANCE_SUPPORT = new Set([
  "overview", "tasks", "approvals", "documents", "calendar", "settings",
  "ai-assistant",
])
const FINANCE_IMPORT_TARGETS = new Set([
  "contact", "vendor", "lead", "product", "sale_order", "purchase_order", "opportunity",
  "account", "sale_order_line", "purchase_order_line", "supplier_info", "account_move",
  "tax_rate", "budget", "hr_employee", "hr_department", "expense", "subscription",
])

export function isWorkspaceSurfaceVisible(profile: WorkspaceProfile, surfaceId: string): boolean {
  return profile === "full" || FINANCE_MODULES.has(surfaceId) || ALPHA_MODULES.has(surfaceId) || FINANCE_SUPPORT.has(surfaceId)
}

/** For global discovery links; do not apply this to record/workflow handoffs. */
export function isWorkspaceHrefVisible(profile: WorkspaceProfile, href: string): boolean {
  return isWorkspaceSurfaceVisible(profile, href.split(/[/?#]/)[1] ?? "")
}

/** Settings catalogs only. Keep the runtime form registry complete for linked workflows. */
export function isWorkspaceFormModuleVisible(profile: WorkspaceProfile, moduleId: string): boolean {
  return profile === "full" || FINANCE_MODULES.has(moduleId) || ALPHA_MODULES.has(moduleId) || ["documents", "calendar"].includes(moduleId)
}

/** Products and employee reference data support Finance without exposing stock or payroll imports. */
export function isWorkspaceImportTargetVisible(profile: WorkspaceProfile, wizardKey: string): boolean {
  return profile === "full" || FINANCE_IMPORT_TARGETS.has(wizardKey)
}
