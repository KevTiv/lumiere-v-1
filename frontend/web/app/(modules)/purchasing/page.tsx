import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState, serverFetchQueryListsRequired } from "@/lib/server-query"
import { PurchasingClient } from "./purchasing-client"

const SSR_RESOURCES = [
  "purchase-orders",
  "purchase-order-lines",
  "purchase-requisitions",
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

  const [records, contactsState] = await Promise.all([
    serverFetchQueryListsRequired(session, SSR_RESOURCES),
    serverFetchQueryListState(session, "contacts"),
  ])
  const [
    orders,
    lines,
    requisitions,
    pricelists,
    products,
    uoms,
    partnerBanks,
    departments,
  ] = records

  return (
    <Suspense>
      <PurchasingClient
        initialOrders={orders}
        initialLines={lines}
        initialRequisitions={requisitions}
        initialContactsState={contactsState}
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
