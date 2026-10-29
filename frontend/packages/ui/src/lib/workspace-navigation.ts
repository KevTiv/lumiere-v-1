import { i18n as uiI18n } from "@lumiere/i18n"
import { buildModuleTabRow, type ModuleConfig, type ModuleTab, type ModuleWorkspace, type ModuleWorkspaceNav } from "./module-types"

/** One navigation model, including modules that have not supplied curated workspaces. */
export function moduleWorkspaceNavigation(config: ModuleConfig, labels = { overview: uiI18n.t("common.workspaceNavigation.overview", { defaultValue: "Overview" }), more: uiI18n.t("common.workspaceNavigation.more", { defaultValue: "More workspaces" }) }): ModuleWorkspaceNav {
  if (config.workspaceNav) return config.workspaceNav
  const grouped = new Map<string, ModuleWorkspace>()
  config.tabGroups?.forEach((group, index) => {
    const workspace = { id: `group-${index}`, label: group.label, tabIds: group.tabIds }
    group.tabIds.forEach((id) => grouped.set(id, workspace))
  })
  const seen = new Set<string>()
  const workspaces = buildModuleTabRow(config.tabs, config.tabGroups).flatMap((item) => {
    if (item.kind !== "tab") return []
    const workspace = grouped.get(item.tab.id) ?? {
      id: item.tab.id,
      label: item.tab.id === "dashboard" || item.tab.type === "dashboard" ? labels.overview : item.tab.label,
      tabIds: [item.tab.id],
    }
    if (seen.has(workspace.id)) return []
    seen.add(workspace.id)
    return [workspace]
  })
  return {
    label: config.title,
    overflowLabel: labels.more,
    workspaces: workspaces.slice(0, 6),
    overflow: workspaces.slice(6),
  }
}

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
  if (remaining.length) overflow.push({ id: "additional", get label() { return uiI18n.t("common.builtIn.workspaceNavigation.resolveWorkspaceNavigation.additional.label", { defaultValue: "Advanced" }) }, tabIds: remaining.map((tab) => tab.id), tabs: remaining })
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
