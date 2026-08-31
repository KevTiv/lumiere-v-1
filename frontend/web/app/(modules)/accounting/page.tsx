import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { AccountingClient } from "./accounting-client"

const SSR_RESOURCES = [
  // Generated company-scoped reads load after active-company resolution in the browser.
  "budgets",
  "analytic-accounts",
  "fiscal-years",
  "account-periods",
] as const

export default async function AccountingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <AccountingClient />
  }

  const [budgets, analytic, fiscalYears, accountPeriods] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <AccountingClient
      initialBudgets={budgets}
      initialAnalytic={analytic}
      initialFiscalYears={fiscalYears}
      initialAccountPeriods={accountPeriods}
      organizationId={session.organizationId}
    />
  )
}
