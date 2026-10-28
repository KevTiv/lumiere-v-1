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
  { value: "current", label: "Current page", group: "Context" },
  { value: "all", label: "All modules", group: "Context", pathname: "/" },
  { value: "group:commercial", label: "Sales & CRM", group: "Module groups", pathname: "/", commands: ["sales", "customers"] },
  { value: "group:operations", label: "Operations", group: "Module groups", pathname: "/", commands: ["inventory"] },
  { value: "group:finance", label: "Finance & reports", group: "Module groups", pathname: "/", commands: ["reports"] },
  { value: "module:sales", label: "Sales", group: "Modules", pathname: "/sales", commands: ["sales"] },
  { value: "module:crm", label: "CRM", group: "Modules", pathname: "/crm", commands: ["customers"] },
  { value: "module:purchasing", label: "Purchasing", group: "Modules", pathname: "/purchasing" },
  { value: "module:inventory", label: "Inventory", group: "Modules", pathname: "/inventory", commands: ["inventory"] },
  { value: "module:manufacturing", label: "Manufacturing", group: "Modules", pathname: "/manufacturing" },
  { value: "module:accounting", label: "Accounting", group: "Modules", pathname: "/accounting" },
  { value: "module:expenses", label: "Expenses", group: "Modules", pathname: "/expenses" },
  { value: "module:subscriptions", label: "Subscriptions", group: "Modules", pathname: "/subscriptions" },
  { value: "module:reports", label: "Reports", group: "Modules", pathname: "/reports", commands: ["reports"] },
  { value: "module:documents", label: "Documents", group: "Modules", pathname: "/documents", commands: ["docs"] },
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
