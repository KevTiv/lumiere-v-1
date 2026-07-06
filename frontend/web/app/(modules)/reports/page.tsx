import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { ReportsClient } from "./reports-client"

const SSR_RESOURCES = [
  "financial-reports",
  "trial-balances",
  "report-templates",
  "scheduled-reports",
  "analytics-metrics",
  "dashboards",
  "dashboard-widgets",
  "saved-reports",
] as const

export default async function ReportsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ReportsClient />
  }

  const [reports, balances, templates, scheduled, metrics, dashboards, widgets] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <ReportsClient
      initialReports={reports}
      initialBalances={balances}
      initialReportTemplates={templates}
      initialScheduledReports={scheduled}
      initialAnalyticsMetrics={metrics}
      initialDashboards={dashboards}
      initialDashboardWidgets={widgets}
      organizationId={session.organizationId}
    />
  )
}
