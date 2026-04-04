import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryExpenses,
  serverQueryExpenseSheets,
  serverQueryPricelists,
  serverQueryEmployees,
} from "@lumiere/stdb/server"
import { ExpensesClient } from "./expenses-client"

export default async function ExpensesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ExpensesClient />
  }
  const { organizationId, opts } = session

  const [expenses, sheets, pricelists, employees] = await Promise.all([
    serverQueryExpenses(organizationId, opts),
    serverQueryExpenseSheets(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryEmployees(organizationId, opts),
  ]).catch(() => [[], [], [], []])

  return (
    <ExpensesClient
      initialExpenses={expenses as Record<string, unknown>[]}
      initialSheets={sheets as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      initialEmployees={employees as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
