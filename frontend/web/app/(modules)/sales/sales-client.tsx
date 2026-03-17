"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { salesModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useSaleOrders,
  useSaleOrderLines,
  usePricelists,
  usePickingBatches,
  useCreateSaleOrder,
  useCreatePricelist,
} from "@lumiere/stdb"
import type {
  CreateSaleOrderParams,
  CreatePricelistParams,
} from "@lumiere/stdb"

interface SalesClientProps {
  initialOrders?: Record<string, unknown>[]
  initialOrderLines?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialDeliveries?: Record<string, unknown>[]
  organizationId?: number
}

export function SalesClient({
  initialOrders,
  initialOrderLines,
  initialPricelists,
  initialDeliveries,
  organizationId,
}: SalesClientProps) {
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  const { data: orders = [] } = useSaleOrders(companyId, initialOrders)
  const { data: orderLines = [] } = useSaleOrderLines(companyId, initialOrderLines)
  const { data: pricelists = [] } = usePricelists(companyId, initialPricelists)
  const { data: deliveries = [] } = usePickingBatches(companyId, initialDeliveries)

  const createSaleOrder = useCreateSaleOrder(orgId, companyId)
  const createPricelist = useCreatePricelist(orgId)

  // Confirmed orders (state = "Sale" or "Done")
  const confirmedOrders = useMemo(
    () => orders.filter((o) => String(o.state) === "Sale" || String(o.state) === "Done"),
    [orders],
  )

  // Live KPI dashboard sections override
  const liveSections = useMemo(() => {
    const revenue = confirmedOrders.reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)
    const orderCount = confirmedOrders.length
    const avgDeal = orderCount > 0 ? revenue / orderCount : 0
    const outstanding = orders.reduce((s, o) => s + Number(o.amountResidual ?? 0), 0)

    const dashboardTab = salesModuleConfig.tabs.find((t) => t.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Revenue MTD", value: `$${revenue.toLocaleString()}`, icon: "TrendingUp" },
                { label: "Orders Confirmed", value: String(orderCount), icon: "ShoppingCart" },
                { label: "Avg Deal Size", value: `$${Math.round(avgDeal).toLocaleString()}`, icon: "DollarSign" },
                { label: "Outstanding AR", value: `$${Math.round(outstanding).toLocaleString()}`, icon: "AlertCircle" },
              ],
            },
          }
        }
        return w
      }),
    }))
  }, [orders, confirmedOrders])

  // Config with live dashboard sections
  const config = useMemo(
    () => ({
      ...salesModuleConfig,
      tabs: salesModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections],
  )

  // Data keyed by tab id
  const data = useMemo(
    () => ({
      orders: orders as unknown as Record<string, unknown>[],
      "order-lines": orderLines as unknown as Record<string, unknown>[],
      pricelists: pricelists as unknown as Record<string, unknown>[],
      deliveries: deliveries as unknown as Record<string, unknown>[],
    }),
    [orders, orderLines, pricelists, deliveries],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createSaleOrder") {
      createSaleOrder.mutate(formData as unknown as CreateSaleOrderParams)
    } else if (action === "createPricelist") {
      createPricelist.mutate(formData as unknown as CreatePricelistParams)
    }
  }

  return (
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
