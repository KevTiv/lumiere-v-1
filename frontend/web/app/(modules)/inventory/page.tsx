import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryProducts,
  serverQueryProductCategories,
  serverQueryUoms,
  serverQueryStockQuants,
  serverQueryStockPickings,
  serverQueryWarehouses,
  serverQueryInventoryAdjustments,
  serverQueryPricelists,
  serverQueryStockLocations,
  serverQueryStockCycleCounts,
  serverQueryStockMoves,
  serverQueryWarehouse3dZones,
  serverQueryInventoryValuations,
  serverQueryReplenishmentRules,
} from "@lumiere/stdb/server"
import { InventoryClient } from "./inventory-client"

export default async function InventoryPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <InventoryClient />
  }

  const [
    products,
    stockQuants,
    transfers,
    warehouses,
    adjustments,
    pricelists,
    productCategories,
    uoms,
    stockLocations,
    stockCycleCounts,
    stockMoves,
    warehouse3dZones,
    inventoryValuations,
    replenishmentRules,
  ] = await Promise.all([
    serverQueryProducts(organizationId, opts),
    serverQueryStockQuants(organizationId, opts),
    serverQueryStockPickings(organizationId, opts),
    serverQueryWarehouses(organizationId, opts),
    serverQueryInventoryAdjustments(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryProductCategories(organizationId, opts),
    serverQueryUoms(organizationId, opts),
    serverQueryStockLocations(organizationId, opts),
    serverQueryStockCycleCounts(organizationId, opts),
    serverQueryStockMoves(organizationId, opts),
    serverQueryWarehouse3dZones(organizationId, opts),
    serverQueryInventoryValuations(organizationId, opts),
    serverQueryReplenishmentRules(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], [], [], [], [], [], [], [], []])

  return (
    <InventoryClient
      initialProducts={products as Record<string, unknown>[]}
      initialStockQuants={stockQuants as Record<string, unknown>[]}
      initialTransfers={transfers as Record<string, unknown>[]}
      initialWarehouses={warehouses as Record<string, unknown>[]}
      initialAdjustments={adjustments as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      initialProductCategories={productCategories as Record<string, unknown>[]}
      initialUoms={uoms as Record<string, unknown>[]}
      initialStockLocations={stockLocations as Record<string, unknown>[]}
      initialStockCycleCounts={stockCycleCounts as Record<string, unknown>[]}
      initialStockMoves={stockMoves as Record<string, unknown>[]}
      initialWarehouse3dZones={warehouse3dZones as Record<string, unknown>[]}
      initialInventoryValuations={inventoryValuations as Record<string, unknown>[]}
      initialReplenishmentRules={replenishmentRules as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
