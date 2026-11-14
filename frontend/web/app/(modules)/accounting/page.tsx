import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { AccountingClient } from "./accounting-client"
import { ModuleCsvHistoryDisclosure } from "../../../components/module-csv-history"

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
    await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <>
      <ModuleCsvHistoryDisclosure organizationId={session.organizationId} view="accounting" />
      <AccountingClient
        initialFiscalYears={fiscalYears}
        initialAccountPeriods={accountPeriods}
        organizationId={session.organizationId}
      />
    </>
  )
}
