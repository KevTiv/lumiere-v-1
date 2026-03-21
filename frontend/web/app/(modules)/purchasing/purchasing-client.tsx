"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newPurchaseOrderForm, newPurchaseRequisitionForm } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { purchasingModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy } from "@/lib/utils"
import {
  usePurchaseOrders,
  usePurchaseOrderLines,
  usePurchaseRequisitions,
  useContacts,
  useCreatePurchaseOrder,
  useCreatePurchaseRequisition,
} from "@lumiere/stdb"

interface PurchasingClientProps {
  initialOrders?: Record<string, unknown>[]
  initialLines?: Record<string, unknown>[]
  initialRequisitions?: Record<string, unknown>[]
  organizationId?: number
}

export function PurchasingClient({
  initialOrders,
  initialLines,
  initialRequisitions,
  organizationId,
}: PurchasingClientProps) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: orders = [] } = usePurchaseOrders(companyId, initialOrders)
  const { data: lines = [] } = usePurchaseOrderLines(companyId, initialLines)
  const { data: requisitions = [] } = usePurchaseRequisitions(companyId, initialRequisitions)
  const { data: allContacts = [] } = useContacts(companyId)

  const vendors = useMemo(
    () => allContacts.filter((c) => c.isVendor || c.supplierRank != null && Number(c.supplierRank) > 0),
    [allContacts],
  )

  const createPurchaseOrder = useCreatePurchaseOrder(orgId, companyId)
  const createPurchaseRequisition = useCreatePurchaseRequisition(orgId, companyId)

  const moduleConfig = useMemo(() => purchasingModuleConfig(t), [t])

  const liveSections = useMemo(() => {
    const openOrders = orders.filter(
      (o) => String(o.state) !== "Done" && String(o.state) !== "Cancelled"
    )
    const spendMtd = orders
      .filter((o) => String(o.state) === "Approved" || String(o.state) === "Done")
      .reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)
    const pendingReceipt = orders.filter((o) => o.receiptStatus === "pending").length
    const toApprove = orders.filter((o) => String(o.state) === "ToApprove").length

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
                { label: "Open POs", value: openOrders.length.toString(), icon: "FileText" },
                { label: "Spend MTD", value: `$${spendMtd.toLocaleString()}`, icon: "DollarSign" },
                { label: "Pending Receipt", value: pendingReceipt.toString(), icon: "Truck" },
                { label: "Awaiting Approval", value: toApprove.toString(), icon: "Clock" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_purchase_order: () => setQuickActionForm({ form: newPurchaseOrderForm(t), action: "createPurchaseOrder" }),
            create_requisition: () => setQuickActionForm({ form: newPurchaseRequisitionForm(t), action: "createPurchaseRequisition" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "pur-by-vendor") {
          const byVendor = groupBy(orders, (o) => String(o.partnerId ?? "Unknown"))
          const vendorValues = Object.entries(byVendor)
            .map(([partnerId, vendOrders]) => ({
              vendor: `Vendor ${partnerId.slice(-4)}`,
              Spend: Math.round(vendOrders.reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)),
            }))
            .sort((a, b) => b.Spend - a.Spend)
            .slice(0, 5)
          return { ...w, data: { ...(w.data as Record<string, unknown>), values: vendorValues } }
        }
        if (w.id === "pur-po-table") {
          const openOrders = orders
            .filter((o) => {
              const state = String(o.state ?? "")
              return state === "Purchase" || state === "Draft" || state === "Sent"
            })
            .slice(0, 4)
            .map((o) => {
              const dateMs = Number(o.dateOrder ?? 0) / 1000
              const dateStr = dateMs > 0 ? new Date(dateMs).toLocaleDateString("en", { month: "short", day: "numeric" }) : "—"
              return {
                po: String(o.name ?? `PO-${String(o.id).slice(-6)}`),
                vendor: `Vendor ${String(o.partnerId ?? "?").slice(-4)}`,
                amount: `$${Number(o.amountTotal ?? 0).toLocaleString()}`,
                ordered: dateStr,
                expected: "—",
                status: String(o.state ?? "Draft"),
              }
            })
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows: openOrders } }
        }
        return w
      }),
    }))
  }, [orders, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }) as ModuleConfig,
    [moduleConfig, liveSections]
  )

  const data = useMemo(
    () => ({
      orders: orders as unknown as Record<string, unknown>[],
      lines: lines as unknown as Record<string, unknown>[],
      requisitions: requisitions as unknown as Record<string, unknown>[],
      vendors: vendors as unknown as Record<string, unknown>[],
    }),
    [orders, lines, requisitions, vendors]
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createPurchaseOrder") createPurchaseOrder.mutate(formData as never)
    else if (action === "createPurchaseRequisition") createPurchaseRequisition.mutate(formData as never)
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
        config={quickActionForm?.form ?? newPurchaseOrderForm(t)}
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
