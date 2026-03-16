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

// TODO: replace with real org/company IDs from auth context
const ORG_ID = 1n
const COMPANY_ID = 1n

export default function SalesPage() {
  const { data: orders = [] } = useSaleOrders(COMPANY_ID)
  const { data: orderLines = [] } = useSaleOrderLines(COMPANY_ID)
  const { data: pricelists = [] } = usePricelists(COMPANY_ID)
  const { data: deliveries = [] } = usePickingBatches(COMPANY_ID)

  const createSaleOrder = useCreateSaleOrder(ORG_ID, COMPANY_ID)
  const createPricelist = useCreatePricelist(ORG_ID)

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
