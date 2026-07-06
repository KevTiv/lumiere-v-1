import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { ManufacturingClient } from "./manufacturing-client"

const SSR_RESOURCES = [
  "mrp-productions",
  "mrp-boms",
  "mrp-bom-lines",
  "mrp-workorders",
  "mrp-workcenters",
  "mrp-routing-workcenters",
  "iot-devices",
  "products",
  "warehouses",
  "stock-pickings",
  "stock-quants",
] as const

export default async function ManufacturingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ManufacturingClient />
  }

  const [
    productions,
    boms,
    bomLines,
    workorders,
    workcenters,
    routingOperations,
    iotDevices,
    products,
    warehouses,
    stockPickings,
    stockQuants,
  ] = await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <Suspense>
      <ManufacturingClient
        initialProductions={productions}
        initialBoms={boms}
        initialBomLines={bomLines}
        initialWorkorders={workorders}
        initialWorkcenters={workcenters}
        initialRoutingOperations={routingOperations}
        initialIotDevices={iotDevices}
        initialProducts={products}
        initialWarehouses={warehouses}
        initialStockPickings={stockPickings}
        initialStockQuants={stockQuants}
        organizationId={session.organizationId}
      />
    </Suspense>
  )
}
