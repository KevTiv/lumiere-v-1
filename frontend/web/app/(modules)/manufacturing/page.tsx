import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryMrpProductions,
  serverQueryMrpBoms,
  serverQueryMrpWorkorders,
  serverQueryMrpWorkcenters,
  serverQueryProducts,
  serverQueryWarehouses,
  serverQueryStockPickings,
  serverQueryStockQuants,
} from "@lumiere/stdb/server"
import { ManufacturingClient } from "./manufacturing-client"

export default async function ManufacturingPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <ManufacturingClient />
  }

  const [
    productions,
    boms,
    workorders,
    workcenters,
    products,
    warehouses,
    stockPickings,
    stockQuants,
  ] = await Promise.all([
    serverQueryMrpProductions(organizationId, opts),
    serverQueryMrpBoms(organizationId, opts),
    serverQueryMrpWorkorders(organizationId, opts),
    serverQueryMrpWorkcenters(organizationId, opts),
    serverQueryProducts(organizationId, opts),
    serverQueryWarehouses(organizationId, opts),
    serverQueryStockPickings(organizationId, opts),
    serverQueryStockQuants(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], [], []])

  return (
    <ManufacturingClient
      initialProductions={productions as Record<string, unknown>[]}
      initialBoms={boms as Record<string, unknown>[]}
      initialWorkorders={workorders as Record<string, unknown>[]}
      initialWorkcenters={workcenters as Record<string, unknown>[]}
      initialProducts={products as Record<string, unknown>[]}
      initialWarehouses={warehouses as Record<string, unknown>[]}
      initialStockPickings={stockPickings as Record<string, unknown>[]}
      initialStockQuants={stockQuants as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
