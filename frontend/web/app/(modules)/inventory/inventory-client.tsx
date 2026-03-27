"use client"

import { useMemo, useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newProductForm, newTransferForm, newInventoryAdjustmentForm } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { inventoryModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy } from "@/lib/utils"
import {
  useProducts,
  useStockQuants,
  useStockPickings,
  useWarehouses,
  useInventoryAdjustments,
  useStockLocations,
  useProductionLots,
  useQualityChecks,
  useCreateProduct,
  useCreateStockPicking,
  useCreateInventoryAdjustment,
  useWarehouse3D,
  useMoveStockItem3D,
} from "@/hooks/inventory"

// WarehouseViewer uses Three.js — must be loaded client-side only, imported directly to avoid SSR barrel evaluation
const WarehouseViewer = dynamic(
  () => import("@lumiere/ui/stock-3d/warehouse-viewer"),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-muted-foreground">Loading 3D viewer…</div> }
)

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
  const { t } = useTranslation()
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: stockQuants = [] } = useStockQuants(companyId, initialStockQuants)
  const { data: transfers = [] } = useStockPickings(companyId, initialTransfers)
  const { data: warehouses = [] } = useWarehouses(companyId, initialWarehouses)
  const { data: adjustments = [] } = useInventoryAdjustments(orgId, initialAdjustments)
  const { data: locations = [] } = useStockLocations(companyId)
  const { data: lots = [] } = useProductionLots(companyId)
  const { data: qualityChecks = [] } = useQualityChecks(companyId)

  const createProduct = useCreateProduct(orgId)
  const createStockPicking = useCreateStockPicking(orgId, companyId)
  const createInventoryAdjustment = useCreateInventoryAdjustment(orgId)

  // 3D viewer — use first warehouse found (or 0n as a no-op before warehouses load)
  const firstWarehouseId = warehouses[0]?.id ? BigInt(String(warehouses[0].id)) : 0n
  const { zones, slots, items: warehouseItems } = useWarehouse3D(orgId, companyId, firstWarehouseId)
  const moveStockItem = useMoveStockItem3D(orgId)

  const moduleConfig = useMemo(() => inventoryModuleConfig(t), [t])

  // Only render the 3D viewer on the client to avoid SSR/hydration tree mismatches
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => setIsMounted(true), [])

  const liveSections = useMemo(() => {
    const totalSkus = products.length
    const stockValue = stockQuants.reduce((s, q) => s + Number(q.value ?? 0), 0)
    const zeroStock = stockQuants.filter((q) => Number(q.availableQuantity ?? 0) <= 0).length
    const pendingTransfers = transfers.filter(
      (transfer) => String(transfer.state) === "confirmed" || String(transfer.state) === "assigned"
    ).length

    return (
      moduleConfig.tabs
        .find((tab) => tab.id === "dashboard")
        ?.sections?.map((section) => ({
          ...section,
          widgets: section.widgets.map((w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: t("inventory.dashboard.totalSKUs"), value: totalSkus.toString(), icon: "Package" },
                    { label: t("inventory.dashboard.stockValue"), value: `$${stockValue.toLocaleString()}`, icon: "DollarSign" },
                    { label: t("inventory.dashboard.zeroStockAlerts"), value: zeroStock.toString(), icon: "AlertTriangle" },
                    { label: t("inventory.dashboard.pendingTransfers"), value: pendingTransfers.toString(), icon: "Truck" },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_product: () => setQuickActionForm({ form: newProductForm(t), action: "createProduct" }),
                create_transfer: () => setQuickActionForm({ form: newTransferForm(t), action: "createTransfer" }),
                create_adjustment: () => setQuickActionForm({ form: newInventoryAdjustmentForm(t), action: "createAdjustment" }),
              }
              return {
                ...w,
                data: {
                  ...w.data,
                  actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
                },
              }
            }
            if (w.id === "inv-by-category") {
              // Group by costMethod as a proxy for category
              const byType = groupBy(stockQuants, (q) => String(q.costMethod ?? "Standard"))
              const colors = ["#6366f1", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444"]
              const allQty = stockQuants.reduce((s, q) => s + Number(q.availableQuantity ?? 0), 0)
              const metrics = Object.entries(byType)
                .map(([label, quants]) => ({
                  label,
                  value: Math.round(quants.reduce((s, q) => s + Number(q.availableQuantity ?? 0), 0)),
                  max: Math.max(1, Math.round(allQty)),
                  color: "#6366f1",
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 5)
                .map((m, i) => ({ ...m, color: colors[i] ?? "#6366f1" }))
              return { ...w, data: { metrics } }
            }
            if (w.id === "inv-movements") {
              const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
              const nowMs = Date.now()
              const sevenDaysAgo = nowMs - 7 * 86400000
              const dayIn: Record<string, number> = {}
              const dayOut: Record<string, number> = {}
              const orderedDays: string[] = []
              for (let i = 6; i >= 0; i--) {
                const d = new Date(nowMs - i * 86400000)
                const label = days[d.getDay()]
                if (!orderedDays.includes(label)) orderedDays.push(label)
                dayIn[label] = 0
                dayOut[label] = 0
              }
              for (const t of transfers) {
                const ms = Number(t.scheduledDate ?? 0) / 1000
                if (ms < sevenDaysAgo || ms > nowMs) continue
                const label = days[new Date(ms).getDay()]
                if (String(t.pickingCode ?? "").toLowerCase().includes("in")) {
                  dayIn[label] = (dayIn[label] ?? 0) + 1
                } else {
                  dayOut[label] = (dayOut[label] ?? 0) + 1
                }
              }
              const values = orderedDays.map((day) => ({ day, In: dayIn[day] ?? 0, Out: dayOut[day] ?? 0 }))
              return { ...w, data: { ...(w.data as Record<string, unknown>), values } }
            }
            if (w.id === "inv-low-stock-table") {
              const lowStock = stockQuants
                .filter((q) => Number(q.availableQuantity ?? 0) <= 0)
                .slice(0, 5)
                .map((q) => {
                  const product = products.find((p) => p.id === q.productId)
                  return {
                    sku: String(product?.defaultCode ?? t("inventory.dashboard.skuFallback", { id: String(q.productId).slice(-4) })),
                    name: String(product?.name ?? t("inventory.dashboard.productFallback", { id: String(q.productId).slice(-4) })),
                    qty: Math.round(Number(q.availableQuantity ?? 0)),
                    reorder: "—",
                    status: "Critical",
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows: lowStock } }
            }
            return w
          }),
        })) ??
      moduleConfig.tabs.find((tab) => tab.id === "dashboard")?.sections ??
      []
    )
  }, [products, stockQuants, transfers, t, moduleConfig])

  const warehouse3DTab = useMemo(
    () => ({
      id: "3d-view",
      label: t("inventory.3dView"),
      type: "custom" as const,
      customContent: isMounted ? (
        <div className="h-[calc(100vh-12rem)]">
          <WarehouseViewer
            zones={zones}
            slots={slots}
            items={warehouseItems}
            warehouseName={warehouses[0]?.name ? String(warehouses[0].name) : undefined}
            onMoveItem={(itemId, targetSlotId) => {
              moveStockItem.mutate({
                quantId: BigInt(itemId),
                targetLocationId: BigInt(targetSlotId),
                quantity: 1,
              })
            }}
          />
        </div>
      ) : null,
    }),
    [zones, slots, warehouseItems, warehouses, moveStockItem, t, isMounted]
  )

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: [
        ...moduleConfig.tabs.map((tab) =>
          tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
        ),
        warehouse3DTab,
      ],
    }) as ModuleConfig,
    [moduleConfig, liveSections, warehouse3DTab]
  )

  const data = useMemo(
    () => ({
      products: products as unknown as Record<string, unknown>[],
      stock: stockQuants as unknown as Record<string, unknown>[],
      transfers: transfers as unknown as Record<string, unknown>[],
      warehouses: warehouses as unknown as Record<string, unknown>[],
      adjustments: adjustments as unknown as Record<string, unknown>[],
      locations: locations as unknown as Record<string, unknown>[],
      lots: lots as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
    }),
    [products, stockQuants, transfers, warehouses, adjustments, locations, lots, qualityChecks]
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
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newProductForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
