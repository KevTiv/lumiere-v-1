import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { AccountingClient } from "./accounting-client"

const SSR_RESOURCES = [
  "account-accounts",
  "account-moves",
  "account-taxes",
  "budgets",
  "analytic-accounts",
  "account-journals",
  "fiscal-years",
  "account-periods",
] as const

export default async function AccountingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <AccountingClient />
  }

  const [accounts, moves, taxes, budgets, analytic, journals, fiscalYears, accountPeriods] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <AccountingClient
      initialAccounts={accounts}
      initialMoves={moves}
      initialTaxes={taxes}
      initialBudgets={budgets}
      initialAnalytic={analytic}
      initialJournals={journals}
      initialFiscalYears={fiscalYears}
      initialAccountPeriods={accountPeriods}
      organizationId={session.organizationId}
    />
  )
}
