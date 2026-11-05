/** Activity stays within admitted alpha routes and preserves the current workspace URL. */
export const ALPHA_HISTORY_MODULES = [
  "accounting", "sales", "crm", "purchasing", "reports", "subscriptions", "expenses",
  "products", "warehouse", "fleet", "documents", "calendar", "tasks", "approvals",
  "settings", "overview", "ai-assistant",
] as const

export type AlphaHistoryModule = typeof ALPHA_HISTORY_MODULES[number]

export function historyActivityModule(pathname: string): AlphaHistoryModule | null {
  const module = pathname.split("/")[1]
  return ALPHA_HISTORY_MODULES.find((candidate) => candidate === module) ?? null
}

export function historyActivityHref(pathname: string, search: string, open: boolean): string {
  if (!historyActivityModule(pathname) || pathname.startsWith("//") || /[?#]/.test(pathname)) {
    throw new Error("Activity requires an alpha workspace path")
  }
  const params = new URLSearchParams(search)
  if (open) params.set("history", "activity")
  else params.delete("history")
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
