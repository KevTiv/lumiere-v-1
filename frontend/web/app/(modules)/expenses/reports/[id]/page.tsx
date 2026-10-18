import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { ExpenseReportPageClient } from "./report-page-client"

const SSR_RESOURCES = ["expenses", "expense-sheets"] as const

interface ExpenseReportPageProps {
  params: Promise<{ id: string }>
}

export default async function ExpenseReportPage({ params }: ExpenseReportPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ExpenseReportPageClient sheetId={id} />
  }

  const [expenses, sheets] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <ExpenseReportPageClient
      sheetId={id}
      initialExpenses={expenses}
      initialSheets={sheets}
      organizationId={session.organizationId}
    />
  )
}
