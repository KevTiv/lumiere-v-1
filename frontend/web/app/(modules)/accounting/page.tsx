import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryAccountAccounts,
  serverQueryAccountJournals,
  serverQueryAccountMoves,
  serverQueryAccountTaxes,
  serverQueryBudgets,
  serverQueryAnalyticAccounts,
  serverQueryFiscalYears,
  serverQueryAccountPeriods,
  type StdbServerQueryOptions,
} from "@lumiere/stdb/server"
import { AccountingClient } from "./accounting-client"

export default async function AccountingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <AccountingClient />
  }
  const { organizationId, opts, fieldAccess } = session
  const queryOpts: StdbServerQueryOptions | undefined = fieldAccess
    ? { ...opts, fieldAccess }
    : opts

  const [accounts, moves, taxes, budgets, analytic, journals, fiscalYears, accountPeriods] =
    await Promise.all([
      serverQueryAccountAccounts(organizationId, queryOpts),
      serverQueryAccountMoves(organizationId, undefined, queryOpts),
      serverQueryAccountTaxes(organizationId, queryOpts),
      serverQueryBudgets(organizationId, queryOpts),
      serverQueryAnalyticAccounts(organizationId, queryOpts),
      serverQueryAccountJournals(organizationId, queryOpts),
      serverQueryFiscalYears(organizationId, queryOpts),
      serverQueryAccountPeriods(organizationId, queryOpts),
    ]).catch(() => [[], [], [], [], [], [], [], []])

  return (
    <AccountingClient
      initialAccounts={accounts as Record<string, unknown>[]}
      initialMoves={moves as Record<string, unknown>[]}
      initialTaxes={taxes as Record<string, unknown>[]}
      initialBudgets={budgets as Record<string, unknown>[]}
      initialAnalytic={analytic as Record<string, unknown>[]}
      initialJournals={journals as Record<string, unknown>[]}
      initialFiscalYears={fiscalYears as Record<string, unknown>[]}
      initialAccountPeriods={accountPeriods as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
