import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQuerySaleOrders,
  serverQuerySaleOrderLines,
  serverQueryPricelists,
  serverQueryPickingBatches,
} from "@lumiere/stdb/server"
import { SalesClient } from "./sales-client"

export default async function SalesPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <SalesClient />
  }

  const [orders, orderLines, pricelists, deliveries] = await Promise.all([
    serverQuerySaleOrders(organizationId, opts),
    serverQuerySaleOrderLines(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryPickingBatches(organizationId, opts),
  ]).catch(() => [[], [], [], []])

  return (
    <SalesClient
      initialOrders={orders as Record<string, unknown>[]}
      initialOrderLines={orderLines as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      initialDeliveries={deliveries as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
