import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { PurchasingClient } from "./purchasing-client"

const SSR_RESOURCES = [
  "purchase-orders",
  "purchase-order-lines",
  "purchase-requisitions",
  "contacts",
  "pricelists",
  "products",
  "uoms",
  "partner-banks",
  "departments",
] as const

export default async function PurchasingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <PurchasingClient />
  }

  const [
    orders,
    lines,
    requisitions,
    contacts,
    pricelists,
    products,
    uoms,
    partnerBanks,
    departments,
  ] = await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <Suspense>
      <PurchasingClient
        initialOrders={orders}
        initialLines={lines}
        initialRequisitions={requisitions}
        initialContacts={contacts}
        initialPricelists={pricelists}
        initialProducts={products}
        initialUoms={uoms}
        initialPartnerBanks={partnerBanks}
        initialDepartments={departments}
        organizationId={session.organizationId}
      />
    </Suspense>
  )
}
