import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState, serverPrefetchQueryLists } from "@/lib/server-query"
import { ReportsClient } from "./reports-client"

const SSR_RESOURCES = [
  "report-templates",
  "scheduled-reports",
  "analytics-metrics",
  "dashboards",
  "dashboard-widgets",
] as const

export default async function ReportsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ReportsClient />
  }

  const [reports, balances, [templates, scheduled, metrics, dashboards, widgets]] = await Promise.all([
    serverFetchQueryListState(session, "financial-reports"),
    serverFetchQueryListState(session, "trial-balances"),
    serverPrefetchQueryLists(session, SSR_RESOURCES),
  ])

  return (
    <ReportsClient
      initialReports={reports.status === "ready" || reports.status === "empty" ? reports.rows : undefined}
      initialBalances={balances.status === "ready" || balances.status === "empty" ? balances.rows : undefined}
      initialReportTemplates={templates}
      initialScheduledReports={scheduled}
      initialAnalyticsMetrics={metrics}
      initialDashboards={dashboards}
      initialDashboardWidgets={widgets}
      organizationId={session.organizationId}
    />
  )
}
