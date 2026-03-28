import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
  serverQueryContacts,
  serverQueryPricelists,
} from "@lumiere/stdb/server"
import { PurchasingClient } from "./purchasing-client"

export default async function PurchasingPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <PurchasingClient />
  }

  const [orders, lines, requisitions, contacts, pricelists] = await Promise.all([
    serverQueryPurchaseOrders(organizationId, opts),
    serverQueryPurchaseOrderLines(organizationId, opts),
    serverQueryPurchaseRequisitions(organizationId, opts),
    serverQueryContacts(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <PurchasingClient
      initialOrders={orders as Record<string, unknown>[]}
      initialLines={lines as Record<string, unknown>[]}
      initialRequisitions={requisitions as Record<string, unknown>[]}
      initialContacts={contacts as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
