import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryExpenses, serverQueryExpenseSheets } from "@lumiere/stdb/server"
import { ExpensesClient } from "./expenses-client"

export default async function ExpensesPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <ExpensesClient />
  }

  const [expenses, sheets] = await Promise.all([
    serverQueryExpenses(organizationId, opts),
    serverQueryExpenseSheets(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <ExpensesClient
      initialExpenses={expenses as Record<string, unknown>[]}
      initialSheets={sheets as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
