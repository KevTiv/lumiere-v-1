"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newSaleOrderForm,
  newPricelistForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  salesParamsToJson,
  toCreatePricelistParams,
  toCreateSaleOrderParams,
} from "@/lib/sales-create-params"
import { salesModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy, groupByMonth } from "@/lib/utils"
import {
  useSaleOrders,
  useSaleOrderLines,
  usePricelists,
  usePickingBatches,
  useCreateSaleOrder,
  useCreatePricelist,
} from "@/hooks/sales"
import { useContacts } from "@/hooks/crm"
import { useWarehouses } from "@/hooks/inventory"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  contactRowsToPartnerSelectOptions,
  pricelistRowsToSelectOptions,
  warehouseRowsToSelectOptions,
} from "@/lib/form-lookup"

interface SalesClientProps {
  initialOrders?: Record<string, unknown>[]
  initialOrderLines?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialDeliveries?: Record<string, unknown>[]
  initialContacts?: Record<string, unknown>[]
  initialWarehouses?: Record<string, unknown>[]
  organizationId?: number
}

type SalesClientLoadedProps = Omit<SalesClientProps, "organizationId"> & {
  organizationId: number
}

export function SalesClient(props: SalesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <SalesClientLoaded {...props} organizationId={props.organizationId} />
}

function SalesClientLoaded({
  initialOrders,
  initialOrderLines,
  initialPricelists,
  initialDeliveries,
  initialContacts,
  initialWarehouses,
  organizationId,
}: SalesClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: orders = [] } = useSaleOrders(companyId, initialOrders)
  const { data: orderLines = [] } = useSaleOrderLines(companyId, initialOrderLines)
  const { data: pricelists = [] } = usePricelists(companyId, initialPricelists)
  const { data: deliveries = [] } = usePickingBatches(companyId, initialDeliveries)
  const { data: contacts = [] } = useContacts(companyId, initialContacts)
  const { data: warehouses = [] } = useWarehouses(companyId, initialWarehouses)

  const createSaleOrder = useCreateSaleOrder(orgId, companyId)
  const createPricelist = useCreatePricelist(orgId)

  const moduleConfig = useMemo(() => salesModuleConfig(t), [t])

  const partnerFieldOptions = useMemo(() => {
    const fromApi = contactRowsToPartnerSelectOptions(contacts)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPartners"), disabled: true }]
  }, [contacts, t])

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const warehouseFieldOptions = useMemo(() => {
    const fromApi = warehouseRowsToSelectOptions(warehouses)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noWarehouses"), disabled: true }]
  }, [warehouses, t])

  const saleOrderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newSaleOrderForm(t), {
        partnerId: partnerFieldOptions,
        pricelistId: pricelistFieldOptions,
        warehouseId: warehouseFieldOptions,
      }),
    [t, partnerFieldOptions, pricelistFieldOptions, warehouseFieldOptions],
  )

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
            create_sale_order: () =>
              setQuickActionForm({ form: saleOrderFormConfig, action: "createSaleOrder" }),
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
  }, [orders, confirmedOrders, orderLines, moduleConfig, t, saleOrderFormConfig])

  // Config with live dashboard sections + lookup-backed create forms
  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") {
            return { ...tab, sections: liveSections }
          }
          if (tab.id === "orders" && tab.type === "entity") {
            return { ...tab, createForm: saleOrderFormConfig }
          }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, saleOrderFormConfig],
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
      const p = toCreateSaleOrderParams(formData, pricelists)
      if (p) createSaleOrder.mutate(salesParamsToJson(p))
    } else if (action === "createPricelist") {
      const p = toCreatePricelistParams(formData)
      if (p) createPricelist.mutate(salesParamsToJson(p))
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
        config={quickActionForm?.form ?? saleOrderFormConfig}
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
