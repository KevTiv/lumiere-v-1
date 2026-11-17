/** Activity stays within admitted alpha routes and preserves the current workspace URL. */
export const ALPHA_HISTORY_MODULES = [
  "accounting", "sales", "crm", "purchasing", "reports", "subscriptions", "expenses",
  "products", "inventory", "warehouse", "fleet", "documents", "calendar", "tasks", "approvals",
  "settings", "overview", "ai-assistant",
] as const

export type AlphaHistoryModule = typeof ALPHA_HISTORY_MODULES[number]

export function historyActivityModule(pathname: string): AlphaHistoryModule | null {
  const module = pathname.split("/")[1]
  return ALPHA_HISTORY_MODULES.find((candidate) => candidate === module) ?? null
}

export function historyActivitySelection(search: { get(name: string): string | null }) {
  const eventId = search.get("historyEvent")
  const companyId = search.get("historyCompany")
  if (eventId === null && companyId === null) return undefined
  return { eventId: eventId ?? "", companyId: companyId ?? "" }
}

export function historyActivityHref(
  pathname: string,
  search: string,
  open: boolean,
  selection?: { eventId: string; companyId: string },
): string {
  if (!historyActivityModule(pathname) || pathname.startsWith("//") || /[?#]/.test(pathname)) {
    throw new Error("Activity requires an alpha workspace path")
  }
  const params = new URLSearchParams(search)
  params.delete("historyEvent")
  params.delete("historyCompany")
  if (open) {
    params.set("history", "activity")
    if (selection) {
      params.set("historyEvent", selection.eventId)
      params.set("historyCompany", selection.companyId)
    }
  } else params.delete("history")
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
