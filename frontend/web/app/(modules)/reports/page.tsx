import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryAnalyticsMetrics,
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

  const [reports, balances, templates, scheduled, metrics] = await Promise.all([
    serverQueryFinancialReports(organizationId, opts),
    serverQueryTrialBalances(organizationId, opts),
    serverQueryReportTemplates(organizationId, opts),
    serverQueryScheduledReports(organizationId, opts),
    serverQueryAnalyticsMetrics(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <ReportsClient
      initialReports={reports as Record<string, unknown>[]}
      initialBalances={balances as Record<string, unknown>[]}
      initialReportTemplates={templates as Record<string, unknown>[]}
      initialScheduledReports={scheduled as Record<string, unknown>[]}
      initialAnalyticsMetrics={metrics as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
