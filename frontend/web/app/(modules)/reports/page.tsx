import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryAnalyticsMetrics,
  serverQueryDashboards,
  serverQueryDashboardWidgets,
  serverQueryFinancialReports,
  serverQueryReportTemplates,
  serverQueryScheduledReports,
  serverQueryTrialBalances,
} from "@lumiere/stdb/server"
import { ReportsClient } from "./reports-client"

export default async function ReportsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ReportsClient />
  }
  const { organizationId, opts } = session

  const [reports, balances, templates, scheduled, metrics, dashboards, widgets] = await Promise.all([
    serverQueryFinancialReports(organizationId, opts),
    serverQueryTrialBalances(organizationId, opts),
    serverQueryReportTemplates(organizationId, opts),
    serverQueryScheduledReports(organizationId, opts),
    serverQueryAnalyticsMetrics(organizationId, opts),
    serverQueryDashboards(organizationId, opts),
    serverQueryDashboardWidgets(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], []])

  return (
    <ReportsClient
      initialReports={reports as Record<string, unknown>[]}
      initialBalances={balances as Record<string, unknown>[]}
      initialReportTemplates={templates as Record<string, unknown>[]}
      initialScheduledReports={scheduled as Record<string, unknown>[]}
      initialAnalyticsMetrics={metrics as Record<string, unknown>[]}
      initialDashboards={dashboards as Record<string, unknown>[]}
      initialDashboardWidgets={widgets as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
