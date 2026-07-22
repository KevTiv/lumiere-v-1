import type { DashboardSection, DashboardWidget } from "./dashboard-types"
import type { ModuleConfig } from "./module-types"

/** Maps the widgets in the dashboard tab, or returns an empty list when absent. */
export function mapDashboardWidgets(
  config: ModuleConfig,
  transform: (widget: DashboardWidget) => unknown,
): DashboardSection[] {
  const sections = config.tabs.find((tab) => tab.id === "dashboard")?.sections
  return sections?.map((section) => ({
    ...section,
    widgets: section.widgets.map((widget) => transform(widget) as DashboardWidget),
  })) ?? []
}

/** Replaces only the dashboard tab sections while preserving every other tab. */
export function withDashboardSections(
  config: ModuleConfig,
  sections: DashboardSection[],
): ModuleConfig {
  return {
    ...config,
    tabs: config.tabs.map((tab) =>
      tab.id === "dashboard" ? { ...tab, sections } : tab,
    ),
  }
}
