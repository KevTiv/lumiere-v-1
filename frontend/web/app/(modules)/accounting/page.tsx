import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryAccountAccounts,
  serverQueryAccountJournals,
  serverQueryAccountMoves,
  serverQueryAccountTaxes,
  serverQueryBudgets,
  serverQueryAnalyticAccounts,
} from "@lumiere/stdb/server"
import { AccountingClient } from "./accounting-client"

export default async function AccountingPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <AccountingClient />
  }

  const [accounts, moves, taxes, budgets, analytic, journals] = await Promise.all([
    serverQueryAccountAccounts(organizationId, opts),
    serverQueryAccountMoves(organizationId, undefined, opts),
    serverQueryAccountTaxes(organizationId, opts),
    serverQueryBudgets(organizationId, opts),
    serverQueryAnalyticAccounts(organizationId, opts),
    serverQueryAccountJournals(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], []])

  return (
    <AccountingClient
      initialAccounts={accounts as Record<string, unknown>[]}
      initialMoves={moves as Record<string, unknown>[]}
      initialTaxes={taxes as Record<string, unknown>[]}
      initialBudgets={budgets as Record<string, unknown>[]}
      initialAnalytic={analytic as Record<string, unknown>[]}
      initialJournals={journals as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
