import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState, serverPrefetchQueryLists } from "@/lib/server-query"
import { ManufacturingClient } from "./manufacturing-client"

const SSR_RESOURCES = [
  "mrp-productions",
  "mrp-boms",
  "mrp-bom-lines",
  "mrp-workorders",
  "mrp-workcenters",
  "mrp-routing-workcenters",
  "products",
  "stock-pickings",
  "stock-quants",
] as const

export default async function ManufacturingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ManufacturingClient />
  }

  const [records, iotDevicesState] = await Promise.all([
    serverPrefetchQueryLists(session, SSR_RESOURCES),
    serverFetchQueryListState(session, "iot-devices"),
  ])
  const [
    productions,
    boms,
    bomLines,
    workorders,
    workcenters,
    routingOperations,
    products,
    stockPickings,
    stockQuants,
  ] = records

  return (
    <Suspense>
      <ManufacturingClient
        initialProductions={productions}
        initialBoms={boms}
        initialBomLines={bomLines}
        initialWorkorders={workorders}
        initialWorkcenters={workcenters}
        initialRoutingOperations={routingOperations}
        initialIotDevicesState={iotDevicesState}
        initialProducts={products}
        initialStockPickings={stockPickings}
        initialStockQuants={stockQuants}
        organizationId={session.organizationId}
      />
    </Suspense>
  )
}
