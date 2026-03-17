import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
} from "@lumiere/stdb/server"
import { PurchasingClient } from "./purchasing-client"

export default async function PurchasingPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <PurchasingClient />
  }

  const [orders, lines, requisitions] = await Promise.all([
    serverQueryPurchaseOrders(organizationId, opts),
    serverQueryPurchaseOrderLines(organizationId, opts),
    serverQueryPurchaseRequisitions(organizationId, opts),
  ]).catch(() => [[], [], []])

  return (
    <PurchasingClient
      initialOrders={orders as Record<string, unknown>[]}
      initialLines={lines as Record<string, unknown>[]}
      initialRequisitions={requisitions as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
