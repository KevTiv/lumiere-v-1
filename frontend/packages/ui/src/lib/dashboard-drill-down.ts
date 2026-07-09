/**
 * Build in-app module tab hrefs for dashboard chart drill-down.
 * Matches `useModuleTab` conventions: `?tab=` when not the default dashboard tab.
 * Optional `filter` params use `key:value` pairs (e.g. `filter=state:New`).
 */
export function buildModuleTabHref(
  moduleId: string,
  tabId: string,
  filter?: Record<string, string>,
  defaultTab = "dashboard",
): string {
  const base = `/${moduleId.replace(/^\/+/, "")}`
  const params = new URLSearchParams()

  if (tabId && tabId !== defaultTab) {
    params.set("tab", tabId)
  }

  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (key && value !== undefined && value !== "") {
        params.append("filter", `${key}:${value}`)
      }
    }
  }

  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}
