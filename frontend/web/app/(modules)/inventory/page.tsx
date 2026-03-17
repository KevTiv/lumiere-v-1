import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryProducts,
  serverQueryStockQuants,
  serverQueryStockPickings,
  serverQueryWarehouses,
  serverQueryInventoryAdjustments,
} from "@lumiere/stdb/server"
import { InventoryClient } from "./inventory-client"

export default async function InventoryPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <InventoryClient />
  }

  const [products, stockQuants, transfers, warehouses, adjustments] = await Promise.all([
    serverQueryProducts(organizationId, opts),
    serverQueryStockQuants(organizationId, opts),
    serverQueryStockPickings(organizationId, opts),
    serverQueryWarehouses(organizationId, opts),
    serverQueryInventoryAdjustments(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <InventoryClient
      initialProducts={products as Record<string, unknown>[]}
      initialStockQuants={stockQuants as Record<string, unknown>[]}
      initialTransfers={transfers as Record<string, unknown>[]}
      initialWarehouses={warehouses as Record<string, unknown>[]}
      initialAdjustments={adjustments as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
