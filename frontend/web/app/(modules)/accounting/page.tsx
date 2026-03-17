import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryAccountAccounts,
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

  const [accounts, moves, taxes, budgets, analytic] = await Promise.all([
    serverQueryAccountAccounts(organizationId, opts),
    serverQueryAccountMoves(organizationId, opts),
    serverQueryAccountTaxes(organizationId, opts),
    serverQueryBudgets(organizationId, opts),
    serverQueryAnalyticAccounts(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <AccountingClient
      initialAccounts={accounts as Record<string, unknown>[]}
      initialMoves={moves as Record<string, unknown>[]}
      initialTaxes={taxes as Record<string, unknown>[]}
      initialBudgets={budgets as Record<string, unknown>[]}
      initialAnalytic={analytic as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
