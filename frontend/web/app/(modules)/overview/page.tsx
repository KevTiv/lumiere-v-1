import { getStdbSession } from "@/lib/api-session"
import {
  serverQuerySaleOrders,
  serverQueryAccountMoves,
  serverQueryStockQuants,
  serverQueryProducts,
  serverQueryTasks,
  serverQueryProjects,
  serverQueryPurchaseOrders,
  serverQueryContacts,
} from "@lumiere/stdb/server"
import { OverviewClient } from "./overview-client"

export default async function OverviewPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <OverviewClient />
  }
  const { organizationId, opts } = session

  const [orders, moves, stockQuants, products, tasks, projects, purchaseOrders, contacts] =
    await Promise.all([
      serverQuerySaleOrders(organizationId, opts),
      serverQueryAccountMoves(organizationId, undefined, opts),
      serverQueryStockQuants(organizationId, opts),
      serverQueryProducts(organizationId, opts),
      serverQueryTasks(organizationId, opts),
      serverQueryProjects(organizationId, opts),
      serverQueryPurchaseOrders(organizationId, opts),
      serverQueryContacts(organizationId, opts),
    ]).catch(() => [[], [], [], [], [], [], [], []])

  return (
    <OverviewClient
      organizationId={organizationId}
      initialOrders={orders as Record<string, unknown>[]}
      initialMoves={moves as Record<string, unknown>[]}
      initialStockQuants={stockQuants as Record<string, unknown>[]}
      initialProducts={products as Record<string, unknown>[]}
      initialTasks={tasks as Record<string, unknown>[]}
      initialProjects={projects as Record<string, unknown>[]}
      initialPurchaseOrders={purchaseOrders as Record<string, unknown>[]}
      initialContacts={contacts as Record<string, unknown>[]}
    />
  )
}
