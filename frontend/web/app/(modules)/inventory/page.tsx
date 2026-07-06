import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { InventoryClient } from "./inventory-client"

const SSR_RESOURCES = [
  "products",
  "stock-quants",
  "stock-pickings",
  "warehouses",
  "inventory-adjustments",
  "pricelists",
  "product-categories",
  "uoms",
  "stock-locations",
  "stock-cycle-counts",
  "stock-moves",
  "warehouse-3d-zones",
  "inventory-valuations",
  "replenishment-rules",
  "stock-production-serials",
] as const

export default async function InventoryPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
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
    stockProductionSerials,
  ] = await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <InventoryClient
      initialProducts={products}
      initialStockQuants={stockQuants}
      initialTransfers={transfers}
      initialWarehouses={warehouses}
      initialAdjustments={adjustments}
      initialPricelists={pricelists}
      initialProductCategories={productCategories}
      initialUoms={uoms}
      initialStockLocations={stockLocations}
      initialStockCycleCounts={stockCycleCounts}
      initialStockMoves={stockMoves}
      initialWarehouse3dZones={warehouse3dZones}
      initialInventoryValuations={inventoryValuations}
      initialReplenishmentRules={replenishmentRules}
      initialStockProductionSerials={stockProductionSerials}
      organizationId={session.organizationId}
    />
  )
}
