import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { AccountingClient } from "./accounting-client"

const SSR_RESOURCES = [
  // Generated company-scoped reads load after active-company resolution in the browser.
  "fiscal-years",
  "account-periods",
] as const

export default async function AccountingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <AccountingClient />
  }

  const [fiscalYears, accountPeriods] =
    await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <AccountingClient
      initialFiscalYears={fiscalYears}
      initialAccountPeriods={accountPeriods}
      organizationId={session.organizationId}
    />
  )
}
