import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { OverviewClient } from "./overview-client"

const SSR_RESOURCES = [
  "sale-orders",
  "stock-quants",
  "products",
  "tasks",
  "projects",
  "purchase-orders",
  "contacts",
] as const

export default async function OverviewPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <OverviewClient />
  }

  const [
    orders,
    stockQuants,
    products,
    tasks,
    projects,
    purchaseOrders,
    contacts,
  ] = await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <OverviewClient
      organizationId={session.organizationId}
      initialOrders={orders}
      initialStockQuants={stockQuants}
      initialProducts={products}
      initialTasks={tasks}
      initialProjects={projects}
      initialPurchaseOrders={purchaseOrders}
      initialContacts={contacts}
    />
  )
}
