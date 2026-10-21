import { moduleTabHref } from "@lumiere/ui/lib/workspace-navigation"

/** Build a workspace destination without carrying a record filter into a different list. */
export function moduleTabDestination({
  pathname,
  query,
  tab,
  defaultTab,
  validTabs,
}: {
  pathname: string
  query: string
  tab: string
  defaultTab: string
  validTabs: readonly string[]
}): string | null {
  if (!validTabs.includes(tab)) return null
  const params = new URLSearchParams(query)
  const current = params.get("tab")
  const activeTab = current && validTabs.includes(current) ? current : defaultTab
  if (tab === activeTab) return null
  return moduleTabHref(pathname, query, tab, defaultTab)
}
