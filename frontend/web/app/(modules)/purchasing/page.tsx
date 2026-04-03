import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
  serverQueryContacts,
  serverQueryPricelists,
  serverQueryProducts,
  serverQueryUoms,
} from "@lumiere/stdb/server"
import { PurchasingClient } from "./purchasing-client"

export default async function PurchasingPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <Suspense><PurchasingClient /></Suspense>
  }

  const [orders, lines, requisitions, contacts, pricelists, products, uoms] = await Promise.all([
    serverQueryPurchaseOrders(organizationId, opts),
    serverQueryPurchaseOrderLines(organizationId, opts),
    serverQueryPurchaseRequisitions(organizationId, opts),
    serverQueryContacts(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryProducts(organizationId, opts),
    serverQueryUoms(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], []])

  return (
    <Suspense>
      <PurchasingClient
        initialOrders={orders as Record<string, unknown>[]}
        initialLines={lines as Record<string, unknown>[]}
        initialRequisitions={requisitions as Record<string, unknown>[]}
        initialContacts={contacts as Record<string, unknown>[]}
        initialPricelists={pricelists as Record<string, unknown>[]}
        initialProducts={products as Record<string, unknown>[]}
        initialUoms={uoms as Record<string, unknown>[]}
        organizationId={organizationId}
      />
    </Suspense>
  )
}
