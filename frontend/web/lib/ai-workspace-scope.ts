import { i18n as uiI18n } from "@lumiere/i18n"
import type { AiEntitySelection } from "@lumiere/query-hooks/ai-ui-context"

/** Scope changes are presentation/retrieval hints, never permission grants. */
export interface AiWorkspaceScopeOption {
  value: string
  label: string
  group: "Context" | "Module groups" | "Modules"
  pathname?: string
  commands?: readonly string[]
}

export const AI_WORKSPACE_SCOPES: readonly AiWorkspaceScopeOption[] = [
  { value: "current", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.currentPage.label") }, group: "Context" },
  { value: "all", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.allModules.label") }, group: "Context", pathname: "/" },
  { value: "group:commercial", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.salesCRM.label") }, group: "Module groups", pathname: "/", commands: ["sales", "customers"] },
  { value: "group:operations", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.operations.label") }, group: "Module groups", pathname: "/", commands: ["inventory"] },
  { value: "group:finance", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.financeReports.label") }, group: "Module groups", pathname: "/", commands: ["reports"] },
  { value: "module:sales", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.sales.label") }, group: "Modules", pathname: "/sales", commands: ["sales"] },
  { value: "module:crm", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.cRM.label") }, group: "Modules", pathname: "/crm", commands: ["customers"] },
  { value: "module:purchasing", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.purchasing.label") }, group: "Modules", pathname: "/purchasing" },
  { value: "module:inventory", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.inventory.label") }, group: "Modules", pathname: "/inventory", commands: ["inventory"] },
  { value: "module:manufacturing", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.manufacturing.label") }, group: "Modules", pathname: "/manufacturing" },
  { value: "module:accounting", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.accounting.label") }, group: "Modules", pathname: "/accounting" },
  { value: "module:expenses", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.expenses.label") }, group: "Modules", pathname: "/expenses" },
  { value: "module:reports", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.reports.label") }, group: "Modules", pathname: "/reports", commands: ["reports"] },
  { value: "module:documents", get label() { return uiI18n.t("aiAssistant.builtIn.aiWorkspaceScope.aIWORKSPACESCOPES.documents.label") }, group: "Modules", pathname: "/documents", commands: ["docs"] },
]

export function resolveAiWorkspaceScope(
  selected: string,
  currentPathname: string,
  selection: AiEntitySelection | null,
): {
  label: string
  pathname: string
  commands: readonly string[]
  selection: AiEntitySelection | null
  usesCurrentPage: boolean
} {
  const option = AI_WORKSPACE_SCOPES.find((scope) => scope.value === selected) ?? AI_WORKSPACE_SCOPES[0]!
  const usesCurrentPage = option.value === "current"
  return {
    label: option.label,
    pathname: usesCurrentPage ? currentPathname : option.pathname ?? "/",
    commands: option.commands ?? [],
    // A selected row must not follow a user to a different module or company scope.
    selection: usesCurrentPage ? selection : null,
    usesCurrentPage,
  }
}
