"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { purchasingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  usePurchaseOrders,
  usePurchaseOrderLines,
  usePurchaseRequisitions,
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
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  const { data: orders = [] } = usePurchaseOrders(companyId, initialOrders)
  const { data: lines = [] } = usePurchaseOrderLines(companyId, initialLines)
  const { data: requisitions = [] } = usePurchaseRequisitions(companyId, initialRequisitions)

  const createPurchaseOrder = useCreatePurchaseOrder(orgId, companyId)
  const createPurchaseRequisition = useCreatePurchaseRequisition(orgId, companyId)

  const liveSections = useMemo(() => {
    const openOrders = orders.filter(
      (o) => String(o.state) !== "Done" && String(o.state) !== "Cancelled"
    )
    const spendMtd = orders
      .filter((o) => String(o.state) === "Approved" || String(o.state) === "Done")
      .reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)
    const pendingReceipt = orders.filter((o) => o.receiptStatus === "pending").length
    const toApprove = orders.filter((o) => String(o.state) === "ToApprove").length

    return (
      purchasingModuleConfig.tabs
        .find((t) => t.id === "dashboard")
        ?.sections?.map((section) => ({
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
            return w
          }),
        })) ??
      purchasingModuleConfig.tabs.find((t) => t.id === "dashboard")?.sections ??
      []
    )
  }, [orders])

  const config = useMemo(
    () => ({
      ...purchasingModuleConfig,
      tabs: purchasingModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }),
    [liveSections]
  )

  const data = useMemo(
    () => ({
      orders: orders as unknown as Record<string, unknown>[],
      lines: lines as unknown as Record<string, unknown>[],
      requisitions: requisitions as unknown as Record<string, unknown>[],
    }),
    [orders, lines, requisitions]
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
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
