import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { ExpensesClient } from "./expenses-client"

const SSR_RESOURCES = ["expenses", "expense-sheets", "pricelists", "employees"] as const

export default async function ExpensesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ExpensesClient />
  }

  const [expenses, sheets, pricelists, employees] = await serverFetchQueryListsAllowEmpty(
    session,
    SSR_RESOURCES,
  )

  return (
    <ExpensesClient
      initialExpenses={expenses}
      initialSheets={sheets}
      initialPricelists={pricelists}
      initialEmployees={employees}
      organizationId={session.organizationId}
    />
  )
}
