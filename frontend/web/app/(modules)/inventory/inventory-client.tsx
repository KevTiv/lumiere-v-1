"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { inventoryModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useProducts,
  useStockQuants,
  useStockPickings,
  useWarehouses,
  useInventoryAdjustments,
  useCreateProduct,
  useCreateStockPicking,
  useCreateInventoryAdjustment,
} from "@lumiere/stdb"

interface InventoryClientProps {
  initialProducts?: Record<string, unknown>[]
  initialStockQuants?: Record<string, unknown>[]
  initialTransfers?: Record<string, unknown>[]
  initialWarehouses?: Record<string, unknown>[]
  initialAdjustments?: Record<string, unknown>[]
  organizationId?: number
}

export function InventoryClient({
  initialProducts,
  initialStockQuants,
  initialTransfers,
  initialWarehouses,
  initialAdjustments,
  organizationId,
}: InventoryClientProps) {
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: stockQuants = [] } = useStockQuants(companyId, initialStockQuants)
  const { data: transfers = [] } = useStockPickings(companyId, initialTransfers)
  const { data: warehouses = [] } = useWarehouses(companyId, initialWarehouses)
  const { data: adjustments = [] } = useInventoryAdjustments(orgId, initialAdjustments)

  const createProduct = useCreateProduct(orgId)
  const createStockPicking = useCreateStockPicking(orgId, companyId)
  const createInventoryAdjustment = useCreateInventoryAdjustment(orgId)

  const liveSections = useMemo(() => {
    const totalSkus = products.length
    const stockValue = stockQuants.reduce((s, q) => s + Number(q.value ?? 0), 0)
    const zeroStock = stockQuants.filter((q) => Number(q.availableQuantity ?? 0) <= 0).length
    const pendingTransfers = transfers.filter(
      (t) => String(t.state) === "confirmed" || String(t.state) === "assigned"
    ).length

    return (
      inventoryModuleConfig.tabs
        .find((t) => t.id === "dashboard")
        ?.sections?.map((section) => ({
          ...section,
          widgets: section.widgets.map((w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: "Total SKUs", value: totalSkus.toString(), icon: "Package" },
                    { label: "Stock Value", value: `$${stockValue.toLocaleString()}`, icon: "DollarSign" },
                    { label: "Zero Stock Alerts", value: zeroStock.toString(), icon: "AlertTriangle" },
                    { label: "Pending Transfers", value: pendingTransfers.toString(), icon: "Truck" },
                  ],
                },
              }
            }
            return w
          }),
        })) ??
      inventoryModuleConfig.tabs.find((t) => t.id === "dashboard")?.sections ??
      []
    )
  }, [products, stockQuants, transfers])

  const config = useMemo(
    () => ({
      ...inventoryModuleConfig,
      tabs: inventoryModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }),
    [liveSections]
  )

  const data = useMemo(
    () => ({
      products: products as unknown as Record<string, unknown>[],
      stock: stockQuants as unknown as Record<string, unknown>[],
      transfers: transfers as unknown as Record<string, unknown>[],
      warehouses: warehouses as unknown as Record<string, unknown>[],
      adjustments: adjustments as unknown as Record<string, unknown>[],
    }),
    [products, stockQuants, transfers, warehouses, adjustments]
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createProduct") createProduct.mutate(formData as never)
    else if (action === "createTransfer") createStockPicking.mutate(formData as never)
    else if (action === "createAdjustment") createInventoryAdjustment.mutate(formData as never)
  }

  return (
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
