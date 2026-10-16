import type { ModuleTab, ModuleWorkspace, ModuleWorkspaceNav } from "./module-types"

export interface ResolvedWorkspace extends ModuleWorkspace {
  tabs: ModuleTab[]
}

/** Resolve against runtime tabs, including those appended by module clients. */
export function resolveWorkspaceNavigation(tabs: readonly ModuleTab[], config: ModuleWorkspaceNav) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]))
  const assigned = new Set<string>()
  const resolve = (groups: readonly ModuleWorkspace[]): ResolvedWorkspace[] => groups.flatMap((group) => {
    const members = group.tabIds.flatMap((id) => {
      const tab = byId.get(id)
      if (!tab || assigned.has(id)) return []
      assigned.add(id)
      return [tab]
    })
    return members.length ? [{ ...group, tabs: members }] : []
  })
  const workspaces = resolve(config.workspaces)
  const overflow = resolve(config.overflow ?? [])
  const remaining = tabs.filter((tab) => !assigned.has(tab.id))
  if (remaining.length) overflow.push({ id: "additional", label: "Advanced", tabIds: remaining.map((tab) => tab.id), tabs: remaining })
  return { workspaces, overflow }
}

/** Keep company and other route context while clearing filters from the previous collection. */
export function moduleTabHref(pathname: string, search: string, tabId: string, defaultTab: string) {
  const params = new URLSearchParams(search)
  params.delete("filter")
  params.delete("highlight")
  if (tabId === defaultTab) params.delete("tab")
  else params.set("tab", tabId)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
