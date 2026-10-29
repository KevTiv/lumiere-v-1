"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { forwardRef, useMemo } from "react"
import { DashboardGrid } from "./dashboard-grid"
import {
  resolveStoredDashboard,
  type StoredDashboardDataSources,
  type StoredDashboardResolution,
  type StoredDashboardSourceStates,
} from "../lib/stored-dashboard-resolver"
import type { DashboardSection } from "../lib/dashboard-types"
import { reportExportSourceProvenance } from "../lib/report-export-provenance"
import type { StoredDashboardDrillTarget } from "../lib/stored-dashboard-drill-target"

interface StoredDashboardViewProps {
  dashboard: Record<string, unknown>
  widgets: Record<string, unknown>[]
  dataSources: StoredDashboardDataSources
  sourceStates?: StoredDashboardSourceStates
  resolution?: StoredDashboardResolution
  timeRange?: { startMs: number; endMs: number }
  testId?: string
  organizationId?: string | number | bigint
  onDrillTarget?: (target: StoredDashboardDrillTarget) => void
}

export const StoredDashboardView = forwardRef<HTMLDivElement, StoredDashboardViewProps>(
  function StoredDashboardView(
    {
      dashboard,
      widgets,
      dataSources,
      sourceStates,
      resolution: suppliedResolution,
      timeRange,
      testId = "stored-dashboard-view",
      organizationId,
      onDrillTarget,
    },
    ref,
  ) {
    useTranslation()
    const language = i18n.resolvedLanguage
    const resolution = useMemo(() => {
      const widgetIds = (dashboard.widgetIds ?? dashboard.widget_ids) as
        | Array<bigint | number>
        | undefined
      if (suppliedResolution) return suppliedResolution
      return resolveStoredDashboard(
        widgets,
        widgetIds ?? [],
        dataSources,
        {
          ...(timeRange ? { startMs: timeRange.startMs, endMs: timeRange.endMs } : {}),
          sourceStates,
          onDrillTarget,
        },
      )
    }, [dashboard, widgets, dataSources, sourceStates, suppliedResolution, timeRange, onDrillTarget, language])

    const exportProvenanceByWidget = useMemo(() => {
      if (organizationId == null) return undefined
      const dashboardId = dashboard.id ?? ""
      const companyId = dashboard.companyId ?? dashboard.company_id ?? ""
      return Object.fromEntries(widgets.map((widget) => {
        const widgetId = widget.id ?? ""
        return [String(widgetId), reportExportSourceProvenance({
          organizationId,
          companyId: companyId as string | number | bigint,
          dashboardId: dashboardId as string | number | bigint,
          widgetId: widgetId as string | number | bigint,
          model: widget.model,
          domain: widget.domain,
          groupBy: widget.groupBy ?? widget.group_by,
          ...(timeRange ?? {}),
        })]
      }))
    }, [dashboard, organizationId, timeRange, widgets])

    const sections = useMemo((): DashboardSection[] => {
      if (resolution.widgets.length === 0) return []

      return [
        {
          id: `stored-dashboard-${String(dashboard.id ?? "view")}`,
          title: String(dashboard.name ?? i18n.t("ui.pages.storedDashboardView.dashboard")),
          widgets: resolution.widgets,
        },
      ]
    }, [dashboard, resolution.widgets, language])

    const firstIssue = resolution.issues[0]
    const hasLoadingSource = resolution.issues.some((issue) => issue.kind === "source-loading")

    if (hasLoadingSource && sections.length === 0) {
      return (
        <p className="text-sm text-muted-foreground" role="status" data-testid={`${testId}-loading`}>
          {i18n.t("ui.pages.storedDashboardView.dashboardDataIsLoading")}</p>
      )
    }

    if (
      sections.length === 0 &&
      (resolution.state === "invalid-definition" ||
        resolution.state === "denied" ||
        resolution.state === "unavailable")
    ) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert" data-testid={`${testId}-${resolution.state}`}>
          <p className="text-sm font-medium">{i18n.t("ui.pages.storedDashboardView.dashboardDataCannotBeRendered")}</p>
          <p className="text-sm text-muted-foreground">{firstIssue?.message}</p>
        </div>
      )
    }

    if (sections.length === 0) {
      return (
        <p className="text-sm text-muted-foreground" data-testid={testId}>
          {i18n.t("ui.pages.storedDashboardView.noWidgetsConfiguredForThisDashboard")}</p>
      )
    }

    return (
      <div ref={ref} data-testid={testId}>
        {resolution.state === "invalid-definition" ? (
          <div
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
            role="alert"
            data-testid={`${testId}-invalid-definition`}
          >
            <p className="text-sm font-medium">{i18n.t("ui.pages.storedDashboardView.dashboardDataContainsAnInvalidDefinition")}</p>
            <p className="text-sm text-muted-foreground">{firstIssue?.message}</p>
          </div>
        ) : null}
        {resolution.state === "partial" ? (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3" role="status" data-testid={`${testId}-partial`}>
            <p className="text-sm font-medium">{i18n.t("ui.pages.storedDashboardView.dashboardDataIsPartial")}</p>
            <p className="text-sm text-muted-foreground">{firstIssue?.message}</p>
          </div>
        ) : null}
        {resolution.state === "empty" ? (
          <p className="mb-3 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
            {i18n.t("ui.pages.storedDashboardView.dashboardSourcesLoadedWithNoRows")}</p>
        ) : null}
        <DashboardGrid
          sections={sections}
          testId={`${testId}-grid`}
          widgetTestIdPrefix="stored-dashboard-widget"
          exportProvenanceByWidget={exportProvenanceByWidget}
        />
      </div>
    )
  },
)
