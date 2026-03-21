"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newSaleOrderForm, newPricelistForm } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { salesModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy, groupByMonth } from "@/lib/utils"
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
  const { t } = useTranslation()
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: orders = [] } = useSaleOrders(companyId, initialOrders)
  const { data: orderLines = [] } = useSaleOrderLines(companyId, initialOrderLines)
  const { data: pricelists = [] } = usePricelists(companyId, initialPricelists)
  const { data: deliveries = [] } = usePickingBatches(companyId, initialDeliveries)

  const createSaleOrder = useCreateSaleOrder(orgId, companyId)
  const createPricelist = useCreatePricelist(orgId)

  const moduleConfig = useMemo(() => salesModuleConfig(t), [t])

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

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
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
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_sale_order: () => setQuickActionForm({ form: newSaleOrderForm(t), action: "createSaleOrder" }),
            create_pricelist: () => setQuickActionForm({ form: newPricelistForm(t), action: "createPricelist" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "sales-revenue-trend") {
          const monthlyRevenue = groupByMonth(
            confirmedOrders,
            (o) => Number(o.dateOrder ?? 0) / 1000,
            (o) => Number(o.amountTotal ?? 0),
            "Revenue",
            6,
          )
          return { ...w, data: { ...(w.data as Record<string, unknown>), values: monthlyRevenue } }
        }
        if (w.id === "sales-by-rep") {
          const byRep = groupBy(confirmedOrders, (o) => String(o.userId ?? "Unknown"))
          const repMetrics = Object.entries(byRep)
            .map(([rep, repOrders]) => ({
              label: rep.slice(-8),
              value: Math.round(repOrders.reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)),
              max: 0,
              color: "#6366f1",
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 4)
          const maxVal = repMetrics[0]?.value ?? 1
          const metricsWithMax = repMetrics.map((m) => ({ ...m, max: maxVal }))
          return { ...w, data: { metrics: metricsWithMax } }
        }
        if (w.id === "sales-by-product") {
          const byProduct = groupBy(orderLines, (l) => String(l.name ?? `Product ${l.productId}`))
          const productValues = Object.entries(byProduct)
            .map(([product, lines]) => ({
              product,
              Revenue: Math.round(lines.reduce((s, l) => s + Number(l.priceSubtotal ?? 0), 0)),
            }))
            .sort((a, b) => b.Revenue - a.Revenue)
            .slice(0, 4)
          return { ...w, data: { ...(w.data as Record<string, unknown>), values: productValues } }
        }
        return w
      }),
    }))
  }, [orders, confirmedOrders, orderLines, moduleConfig, t])

  // Config with live dashboard sections
  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }) as ModuleConfig,
    [moduleConfig, liveSections],
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
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newSaleOrderForm(t)}
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
