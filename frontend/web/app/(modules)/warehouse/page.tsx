import { getStdbSession } from "@/lib/api-session";
import { serverPrefetchQueryLists } from "@/lib/server-query";
import { InventoryClient } from "../inventory/inventory-client";

const WAREHOUSE_RESOURCES = [
  "products", "stock-quants", "stock-pickings", "warehouses",
  "inventory-adjustments", "uoms", "stock-locations", "stock-cycle-counts",
  "stock-moves", "replenishment-rules", "stock-production-serials",
] as const;

export default async function WarehousePage() {
  const session = await getStdbSession();
  if (!session?.organizationId) return <InventoryClient workspace="warehouse" />;

  const [products, stockQuants, transfers, warehouses, adjustments, uoms,
    locations, cycleCounts, stockMoves, replenishmentRules, serials] =
    await serverPrefetchQueryLists(session, WAREHOUSE_RESOURCES);

  return (
    <InventoryClient
      workspace="warehouse"
      organizationId={session.organizationId}
      initialProducts={products}
      initialStockQuants={stockQuants}
      initialTransfers={transfers}
      initialWarehouses={warehouses}
      initialAdjustments={adjustments}
      initialUoms={uoms}
      initialStockLocations={locations}
      initialStockCycleCounts={cycleCounts}
      initialStockMoves={stockMoves}
      initialReplenishmentRules={replenishmentRules}
      initialStockProductionSerials={serials}
    />
  );
}
