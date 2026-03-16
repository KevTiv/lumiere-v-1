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

const ORG_ID = 1n
const COMPANY_ID = 1n

export default function InventoryPage() {
  const { data: products = [] } = useProducts(ORG_ID)
  const { data: stockQuants = [] } = useStockQuants(COMPANY_ID)
  const { data: transfers = [] } = useStockPickings(COMPANY_ID)
  const { data: warehouses = [] } = useWarehouses(COMPANY_ID)
  const { data: adjustments = [] } = useInventoryAdjustments(ORG_ID)

  const createProduct = useCreateProduct(ORG_ID)
  const createStockPicking = useCreateStockPicking(ORG_ID, COMPANY_ID)
  const createInventoryAdjustment = useCreateInventoryAdjustment(ORG_ID)

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
