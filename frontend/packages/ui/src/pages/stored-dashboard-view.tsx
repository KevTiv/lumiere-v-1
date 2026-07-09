"use client"

import { useMemo } from "react"
import { DashboardGrid } from "./dashboard-grid"
import {
  resolveStoredDashboardWidgets,
  type StoredDashboardDataSources,
} from "../lib/stored-dashboard-resolver"
import type { DashboardSection } from "../lib/dashboard-types"

interface StoredDashboardViewProps {
  dashboard: Record<string, unknown>
  widgets: Record<string, unknown>[]
  dataSources: StoredDashboardDataSources
  testId?: string
}

export function StoredDashboardView({
  dashboard,
  widgets,
  dataSources,
  testId = "stored-dashboard-view",
}: StoredDashboardViewProps) {
  const sections = useMemo((): DashboardSection[] => {
    const widgetIds = (dashboard.widgetIds ?? dashboard.widget_ids) as
      | Array<bigint | number>
      | undefined
    if (!widgetIds?.length) return []

    const resolved = resolveStoredDashboardWidgets(widgets, widgetIds, dataSources)
    if (resolved.length === 0) return []

    return [
      {
        id: `stored-dashboard-${String(dashboard.id ?? "view")}`,
        title: String(dashboard.name ?? "Dashboard"),
        widgets: resolved,
      },
    ]
  }, [dashboard, widgets, dataSources])

  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={testId}>
        No widgets configured for this dashboard.
      </p>
    )
  }

  return <DashboardGrid sections={sections} testId={testId} />
}
