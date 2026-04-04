import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryMrpProductions,
  serverQueryMrpBoms,
  serverQueryMrpBomLines,
  serverQueryMrpWorkorders,
  serverQueryMrpWorkcenters,
  serverQueryMrpRoutingWorkcenters,
  serverQueryIotDevices,
  serverQueryProducts,
  serverQueryWarehouses,
  serverQueryStockPickings,
  serverQueryStockQuants,
} from "@lumiere/stdb/server"
import { ManufacturingClient } from "./manufacturing-client"

export default async function ManufacturingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <Suspense><ManufacturingClient /></Suspense>
  }
  const { organizationId, opts } = session

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
  ] = await Promise.all([
    serverQueryMrpProductions(organizationId, opts),
    serverQueryMrpBoms(organizationId, opts),
    serverQueryMrpBomLines(organizationId, opts),
    serverQueryMrpWorkorders(organizationId, opts),
    serverQueryMrpWorkcenters(organizationId, opts),
    serverQueryMrpRoutingWorkcenters(organizationId, opts),
    serverQueryIotDevices(organizationId, opts),
    serverQueryProducts(organizationId, opts),
    serverQueryWarehouses(organizationId, opts),
    serverQueryStockPickings(organizationId, opts),
    serverQueryStockQuants(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], [], [], [], [], []])

  return (
    <Suspense>
      <ManufacturingClient
        initialProductions={productions as Record<string, unknown>[]}
        initialBoms={boms as Record<string, unknown>[]}
        initialBomLines={bomLines as Record<string, unknown>[]}
        initialWorkorders={workorders as Record<string, unknown>[]}
        initialWorkcenters={workcenters as Record<string, unknown>[]}
        initialRoutingOperations={routingOperations as Record<string, unknown>[]}
        initialIotDevices={iotDevices as Record<string, unknown>[]}
        initialProducts={products as Record<string, unknown>[]}
        initialWarehouses={warehouses as Record<string, unknown>[]}
        initialStockPickings={stockPickings as Record<string, unknown>[]}
        initialStockQuants={stockQuants as Record<string, unknown>[]}
        organizationId={organizationId}
      />
    </Suspense>
  )
}
