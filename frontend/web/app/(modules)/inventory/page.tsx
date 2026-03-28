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
} from "@lumiere/stdb/server"
import { InventoryClient } from "./inventory-client"

export default async function InventoryPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <InventoryClient />
  }

  const [products, stockQuants, transfers, warehouses, adjustments, pricelists, productCategories, uoms] =
    await Promise.all([
      serverQueryProducts(organizationId, opts),
      serverQueryStockQuants(organizationId, opts),
      serverQueryStockPickings(organizationId, opts),
      serverQueryWarehouses(organizationId, opts),
      serverQueryInventoryAdjustments(organizationId, opts),
      serverQueryPricelists(organizationId, opts),
      serverQueryProductCategories(organizationId, opts),
      serverQueryUoms(organizationId, opts),
    ]).catch(() => [[], [], [], [], [], [], [], []])

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
      organizationId={organizationId}
    />
  )
}
