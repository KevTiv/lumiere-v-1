import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState } from "@/lib/server-query"
import { OverviewClient } from "./overview-client"

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
  ] = await Promise.all([
    serverFetchQueryListState(session, "sale-orders"),
    serverFetchQueryListState(session, "stock-quants"),
    serverFetchQueryListState(session, "products"),
    serverFetchQueryListState(session, "tasks"),
    serverFetchQueryListState(session, "projects"),
    serverFetchQueryListState(session, "purchase-orders"),
    serverFetchQueryListState(session, "contacts"),
  ])

  const initialResourceStates = {
    "sale-orders": orders,
    "stock-quants": stockQuants,
    products,
    tasks,
    projects,
    "purchase-orders": purchaseOrders,
    contacts,
  }

  return (
    <OverviewClient
      organizationId={session.organizationId}
      initialResourceStates={initialResourceStates}
      initialOrders={orders.status === "ready" || orders.status === "empty" ? orders.rows : undefined}
      initialStockQuants={stockQuants.status === "ready" || stockQuants.status === "empty" ? stockQuants.rows : undefined}
      initialProducts={products.status === "ready" || products.status === "empty" ? products.rows : undefined}
      initialTasks={tasks.status === "ready" || tasks.status === "empty" ? tasks.rows : undefined}
      initialProjects={projects.status === "ready" || projects.status === "empty" ? projects.rows : undefined}
      initialPurchaseOrders={purchaseOrders.status === "ready" || purchaseOrders.status === "empty" ? purchaseOrders.rows : undefined}
      initialContacts={contacts.status === "ready" || contacts.status === "empty" ? contacts.rows : undefined}
    />
  )
}
