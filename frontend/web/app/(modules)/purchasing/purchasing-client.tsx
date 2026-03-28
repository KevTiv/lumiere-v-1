"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newPurchaseOrderForm,
  newPurchaseRequisitionForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { purchasingModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy } from "@/lib/utils"
import {
  usePurchaseOrders,
  usePurchaseOrderLines,
  usePurchaseRequisitions,
  useCreatePurchaseOrder,
  useCreatePurchaseRequisition,
  useContacts,
} from "@/hooks/purchasing"
import { usePricelists } from "@/hooks/sales"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  contactRowsToVendorSelectOptions,
  pricelistRowsToSelectOptions,
} from "@/lib/form-lookup"

interface PurchasingClientProps {
  initialOrders?: Record<string, unknown>[]
  initialLines?: Record<string, unknown>[]
  initialRequisitions?: Record<string, unknown>[]
  initialContacts?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  organizationId?: number
}

type PurchasingClientLoadedProps = Omit<PurchasingClientProps, "organizationId"> & {
  organizationId: number
}

export function PurchasingClient(props: PurchasingClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <PurchasingClientLoaded {...props} organizationId={props.organizationId} />
}

function PurchasingClientLoaded({
  initialOrders,
  initialLines,
  initialRequisitions,
  initialContacts,
  initialPricelists,
  organizationId,
}: PurchasingClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: orders = [] } = usePurchaseOrders(companyId, initialOrders)
  const { data: lines = [] } = usePurchaseOrderLines(companyId, initialLines)
  const { data: requisitions = [] } = usePurchaseRequisitions(companyId, initialRequisitions)
  const { data: allContacts = [] } = useContacts(companyId, initialContacts)
  const { data: pricelists = [] } = usePricelists(companyId, initialPricelists)

  const vendors = useMemo(
    () => allContacts.filter((c) => c.isVendor || (c.supplierRank != null && Number(c.supplierRank) > 0)),
    [allContacts],
  )

  const createPurchaseOrder = useCreatePurchaseOrder(orgId, companyId)
  const createPurchaseRequisition = useCreatePurchaseRequisition(orgId, companyId)

  const moduleConfig = useMemo(() => purchasingModuleConfig(t), [t])

  const vendorFieldOptions = useMemo(() => {
    const fromApi = contactRowsToVendorSelectOptions(allContacts)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noVendors"), disabled: true }]
  }, [allContacts, t])

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const purchaseOrderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPurchaseOrderForm(t), {
        partnerId: vendorFieldOptions,
        pricelistId: pricelistFieldOptions,
      }),
    [t, vendorFieldOptions, pricelistFieldOptions],
  )

  const purchaseRequisitionFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPurchaseRequisitionForm(t), {
        vendorId: vendorFieldOptions,
      }),
    [t, vendorFieldOptions],
  )

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
                { label: t("purchasing.dashboard.openPOs"), value: openOrders.length.toString(), icon: "FileText" },
                { label: t("purchasing.dashboard.spendMTD"), value: `$${spendMtd.toLocaleString()}`, icon: "DollarSign" },
                { label: t("purchasing.dashboard.pendingReceipt"), value: pendingReceipt.toString(), icon: "Truck" },
                { label: t("purchasing.dashboard.awaitingApproval"), value: toApprove.toString(), icon: "Clock" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_purchase_order: () =>
              setQuickActionForm({ form: purchaseOrderFormConfig, action: "createPurchaseOrder" }),
            create_requisition: () =>
              setQuickActionForm({ form: purchaseRequisitionFormConfig, action: "createPurchaseRequisition" }),
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
              vendor: t("purchasing.dashboard.vendorLabel", { id: partnerId.slice(-4) }),
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
                vendor: t("purchasing.dashboard.vendorLabel", { id: String(o.partnerId ?? "?").slice(-4) }),
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
  }, [orders, moduleConfig, t, purchaseOrderFormConfig, purchaseRequisitionFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") {
            return { ...tab, sections: liveSections }
          }
          if (tab.id === "orders" && tab.type === "entity") {
            return { ...tab, createForm: purchaseOrderFormConfig }
          }
          if (tab.id === "requisitions" && tab.type === "entity") {
            return { ...tab, createForm: purchaseRequisitionFormConfig }
          }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, purchaseOrderFormConfig, purchaseRequisitionFormConfig],
  )

  const data = useMemo(
    () => ({
      orders: orders as unknown as Record<string, unknown>[],
      lines: lines as unknown as Record<string, unknown>[],
      requisitions: requisitions as unknown as Record<string, unknown>[],
      vendors: vendors as unknown as Record<string, unknown>[],
    }),
    [orders, lines, requisitions, vendors],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createPurchaseOrder") {
      const partnerRaw = formData.partnerId
      const pricelistRaw = formData.pricelistId
      if (partnerRaw === "" || partnerRaw == null) return
      if (pricelistRaw === "" || pricelistRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(pricelistRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const currencyId = Number(pl.currencyId)

      createPurchaseOrder.mutate({
        partnerId: Number(partnerRaw),
        currencyId,
        origin: formData.origin ? String(formData.origin) : undefined,
        partnerRef: formData.partnerRef ? String(formData.partnerRef) : undefined,
        notes: formData.notes ? String(formData.notes) : undefined,
        datePlanned: formData.datePlanned ? new Date(String(formData.datePlanned)) : undefined,
        paymentTermId:
          formData.paymentTermId != null && formData.paymentTermId !== ""
            ? Number(formData.paymentTermId)
            : undefined,
        fiscalPositionId: undefined,
        incotermId: undefined,
        incotermLocation: undefined,
        userId: undefined,
        invoiceIds: [],
        pickingIds: [],
        messageFollowerIds: [],
        messageIds: [],
        activityIds: [],
        isQuantityCopy: undefined,
        metadata: undefined,
      } as never)
    } else if (action === "createPurchaseRequisition") {
      const vendorRaw = formData.vendorId
      createPurchaseRequisition.mutate({
        description: formData.description ? String(formData.description) : undefined,
        orderingDate: formData.orderingDate
          ? new Date(String(formData.orderingDate))
          : undefined,
        dateEnd: formData.dateEnd ? new Date(String(formData.dateEnd)) : undefined,
        scheduleDate: formData.scheduleDate
          ? new Date(String(formData.scheduleDate))
          : undefined,
        departmentId:
          formData.departmentId != null && formData.departmentId !== ""
            ? Number(formData.departmentId)
            : undefined,
        exclusive: undefined,
        multipleProduct: false,
        lineIds: [],
        purchaseIds: [],
        vendorId:
          vendorRaw !== "" && vendorRaw != null ? Number(vendorRaw) : undefined,
        activityIds: [],
        messageFollowerIds: [],
        messageIds: [],
        metadata: formData.origin
          ? JSON.stringify({ origin: String(formData.origin) })
          : undefined,
      } as never)
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
        config={quickActionForm?.form ?? purchaseOrderFormConfig}
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
