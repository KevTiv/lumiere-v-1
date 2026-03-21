import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryFinancialReports,
  serverQueryTrialBalances,
} from "@lumiere/stdb/server"
import { ReportsClient } from "./reports-client"

export default async function ReportsPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <ReportsClient />
  }

  const [reports, balances] = await Promise.all([
    serverQueryFinancialReports(organizationId, opts),
    serverQueryTrialBalances(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <ReportsClient
      initialReports={reports as Record<string, unknown>[]}
      initialBalances={balances as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
