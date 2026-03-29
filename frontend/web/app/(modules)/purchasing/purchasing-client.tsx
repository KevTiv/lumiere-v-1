"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newPurchaseOrderForm,
  newPurchaseRequisitionForm,
  addPurchaseOrderLineForm,
  receivePurchaseOrderLineForm,
  invoicePurchaseOrderLineForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  purchaseOrdersTableConfig,
  purchaseOrderLinesTableConfig,
  purchaseRequisitionsTableConfig,
} from "@lumiere/ui"
import type { EntityViewConfig, EntityTableConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import { purchasingModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy } from "@/lib/utils"
import {
  usePurchaseOrders,
  usePurchaseOrderLines,
  usePurchaseRequisitions,
  useCreatePurchaseOrder,
  useCreatePurchaseRequisition,
  useSendPurchaseOrder,
  useConfirmPurchaseOrder,
  useCancelPurchaseOrder,
  useAddPurchaseOrderLine,
  useRemovePurchaseOrderLine,
  useReceivePurchaseOrderLine,
  useInvoicePurchaseOrderLine,
  useSubmitPurchaseRequisition,
  useApprovePurchaseRequisition,
  useClosePurchaseRequisition,
  useCancelPurchaseRequisition,
  useComputePurchaseOrderTotals,
  useComputePurchaseOrderLineTotals,
  useContacts,
} from "@/hooks/purchasing"
import { usePricelists } from "@/hooks/sales"
import { useProducts, useUoms } from "@/hooks/inventory"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  contactRowsToVendorSelectOptions,
  pricelistRowsToSelectOptions,
  productRowsToSelectOptions,
  uomRowsToSelectOptions,
  purchaseOrderRowsToSelectOptions,
  purchaseOrderLineRowsToReceiveOptions,
  purchaseOrderLineRowsToInvoiceOptions,
} from "@/lib/form-lookup"
import {
  toAddPurchaseOrderLineParams,
  toInvoicePoLineArgs,
  toReceivePoLineArgs,
} from "@/lib/purchasing-create-params"

function poState(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function requisitionState(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

interface PurchasingClientProps {
  initialOrders?: Record<string, unknown>[]
  initialLines?: Record<string, unknown>[]
  initialRequisitions?: Record<string, unknown>[]
  initialContacts?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialProducts?: Record<string, unknown>[]
  initialUoms?: Record<string, unknown>[]
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
  initialProducts,
  initialUoms,
  organizationId,
}: PurchasingClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const moduleConfig = useMemo(() => purchasingModuleConfig(t), [t])
  const [activeTab, setActiveTab] = useState(moduleConfig.defaultTab ?? "dashboard")
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(
    null,
  )

  const { data: orders = [] } = usePurchaseOrders(companyId, initialOrders)
  const { data: lines = [] } = usePurchaseOrderLines(companyId, initialLines)
  const { data: requisitions = [] } = usePurchaseRequisitions(companyId, initialRequisitions)
  const { data: allContacts = [] } = useContacts(companyId, initialContacts)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: products = [] } = useProducts(companyId, initialProducts)
  const { data: uoms = [] } = useUoms(companyId, initialUoms)

  const createPurchaseOrder = useCreatePurchaseOrder(orgId, companyId)
  const createPurchaseRequisition = useCreatePurchaseRequisition(orgId, companyId)
  const sendPurchaseOrder = useSendPurchaseOrder(orgId)
  const confirmPurchaseOrder = useConfirmPurchaseOrder(orgId)
  const cancelPurchaseOrder = useCancelPurchaseOrder(orgId)
  const addPurchaseOrderLine = useAddPurchaseOrderLine(orgId)
  const removePurchaseOrderLine = useRemovePurchaseOrderLine(orgId)
  const receivePurchaseOrderLine = useReceivePurchaseOrderLine(orgId)
  const invoicePurchaseOrderLine = useInvoicePurchaseOrderLine(orgId)
  const submitPurchaseRequisition = useSubmitPurchaseRequisition(orgId)
  const approvePurchaseRequisition = useApprovePurchaseRequisition(orgId)
  const closePurchaseRequisition = useClosePurchaseRequisition(orgId)
  const cancelPurchaseRequisition = useCancelPurchaseRequisition(orgId)
  const computePoTotals = useComputePurchaseOrderTotals(orgId)
  const computePoLineTotals = useComputePurchaseOrderLineTotals(orgId)

  const vendors = useMemo(
    () => allContacts.filter((c) => c.isVendor || (c.supplierRank != null && Number(c.supplierRank) > 0)),
    [allContacts],
  )

  const productLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) {
      m.set(
        String(p.id),
        String(p.displayName ?? p.name ?? p.defaultCode ?? p.code ?? p.id),
      )
    }
    return (id: string) => m.get(id) ?? `Product ${id}`
  }, [products])

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

  const productFieldOptions = useMemo(() => {
    const fromApi = productRowsToSelectOptions(products)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noProducts"), disabled: true }]
  }, [products, t])

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noUoms"), disabled: true }]
  }, [uoms, t])

  const draftPoOptions = useMemo(
    () => purchaseOrderRowsToSelectOptions(orders as Record<string, unknown>[], { draftOnly: true }),
    [orders],
  )

  const receiveLineOptions = useMemo(
    () => purchaseOrderLineRowsToReceiveOptions(lines as Record<string, unknown>[], productLabel),
    [lines, productLabel],
  )

  const invoiceLineOptions = useMemo(
    () => purchaseOrderLineRowsToInvoiceOptions(lines as Record<string, unknown>[], productLabel),
    [lines, productLabel],
  )

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

  const addLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(addPurchaseOrderLineForm(t), {
        orderId: draftPoOptions,
        productId: productFieldOptions,
        uomId: uomFieldOptions,
      }),
    [t, draftPoOptions, productFieldOptions, uomFieldOptions],
  )

  const receiveLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(receivePurchaseOrderLineForm(t), {
        lineId: receiveLineOptions,
      }),
    [t, receiveLineOptions],
  )

  const invoiceLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(invoicePurchaseOrderLineForm(t), {
        lineId: invoiceLineOptions,
      }),
    [t, invoiceLineOptions],
  )

  const ordersEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseOrdersTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "po-send",
            label: t("purchasing.actions.sendSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (poState(r) === "Draft") {
                  void sendPurchaseOrder.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "po-confirm",
            label: t("purchasing.actions.confirmSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const st = poState(r)
                if (st === "Sent" || st === "ToApprove" || st === "Draft") {
                  void confirmPurchaseOrder.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "po-cancel",
            label: t("purchasing.actions.cancelSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                const st = poState(r)
                if (st !== "Done" && st !== "Cancelled") {
                  void cancelPurchaseOrder.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "po-recalc",
            label: t("purchasing.actions.recalculateTotals"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void computePoTotals.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "po-recalc-lines",
            label: t("purchasing.actions.recalculateLineTotals"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void computePoLineTotals.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
        ],
      },
    }
  }, [
    t,
    sendPurchaseOrder,
    confirmPurchaseOrder,
    cancelPurchaseOrder,
    computePoTotals,
    computePoLineTotals,
  ])

  const linesEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseOrderLinesTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "pol-add-form",
            label: t("purchasing.actions.addLineForm"),
            onClick: () =>
              setQuickActionForm({ form: addLineFormConfig, action: "addPurchaseOrderLine" }),
          },
          {
            id: "pol-receive-form",
            label: t("purchasing.actions.receiveGoodsForm"),
            onClick: () =>
              setQuickActionForm({ form: receiveLineFormConfig, action: "receivePurchaseOrderLine" }),
          },
          {
            id: "pol-invoice-form",
            label: t("purchasing.actions.invoiceQtyForm"),
            onClick: () =>
              setQuickActionForm({ form: invoiceLineFormConfig, action: "invoicePurchaseOrderLine" }),
          },
          {
            id: "pol-remove",
            label: t("common.delete"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                void removePurchaseOrderLine.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "pol-receive-qty",
            label: t("purchasing.actions.receiveFullOpenQty"),
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first) return
              const pq = Number(first.productQty ?? 0)
              const qr = Number(first.qtyReceived ?? 0)
              const maxRecv = Math.max(0, pq - qr)
              if (maxRecv <= 0) return
              void receivePurchaseOrderLine.mutateAsync({
                lineId: first.id as string | number | bigint,
                qty: maxRecv,
              })
            },
          },
        ],
      },
    }
  }, [
    t,
    addLineFormConfig,
    receiveLineFormConfig,
    invoiceLineFormConfig,
    removePurchaseOrderLine,
    receivePurchaseOrderLine,
  ])

  const requisitionsEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseRequisitionsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "req-submit",
            label: t("purchasing.actions.submitSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (requisitionState(r) === "Draft") {
                  void submitPurchaseRequisition.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "req-approve",
            label: t("purchasing.actions.approveSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (requisitionState(r) === "InProgress") {
                  void approvePurchaseRequisition.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "req-close",
            label: t("purchasing.actions.closeSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void closePurchaseRequisition.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "req-cancel",
            label: t("purchasing.actions.cancelRequisitions"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                const st = requisitionState(r)
                if (st !== "Closed" && st !== "Cancelled") {
                  void cancelPurchaseRequisition.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
        ],
      },
    }
  }, [t, submitPurchaseRequisition, approvePurchaseRequisition, closePurchaseRequisition, cancelPurchaseRequisition])

  const liveSections = useMemo(() => {
    const openOrders = orders.filter(
      (o) => String(o.state) !== "Done" && String(o.state) !== "Cancelled",
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
            receive_goods: () =>
              setQuickActionForm({ form: receiveLineFormConfig, action: "receivePurchaseOrderLine" }),
            view_vendors: () => setActiveTab("vendors"),
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
          const openRows = orders
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
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows: openRows } }
        }
        return w
      }),
    }))
  }, [orders, moduleConfig, t, purchaseOrderFormConfig, purchaseRequisitionFormConfig, receiveLineFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") {
            return { ...tab, sections: liveSections }
          }
          if (tab.id === "orders" && tab.type === "entity") {
            return { ...tab, entityConfig: ordersEntityConfig, createForm: purchaseOrderFormConfig }
          }
          if (tab.id === "lines" && tab.type === "entity") {
            return { ...tab, entityConfig: linesEntityConfig }
          }
          if (tab.id === "requisitions" && tab.type === "entity") {
            return { ...tab, entityConfig: requisitionsEntityConfig, createForm: purchaseRequisitionFormConfig }
          }
          return tab
        }),
      }) as ModuleConfig,
    [
      moduleConfig,
      liveSections,
      purchaseOrderFormConfig,
      purchaseRequisitionFormConfig,
      ordersEntityConfig,
      linesEntityConfig,
      requisitionsEntityConfig,
    ],
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
    formData: Record<string, unknown>,
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
    } else if (action === "addPurchaseOrderLine") {
      const params = toAddPurchaseOrderLineParams(formData)
      const orderId = formData.orderId
      if (params == null || orderId === "" || orderId == null) return
      void addPurchaseOrderLine.mutateAsync({
        orderId: orderId as string | number | bigint,
        params,
      })
    } else if (action === "receivePurchaseOrderLine") {
      const args = toReceivePoLineArgs(formData)
      if (args == null) return
      void receivePurchaseOrderLine.mutateAsync(args)
    } else if (action === "invoicePurchaseOrderLine") {
      const args = toInvoicePoLineArgs(formData)
      if (args == null) return
      void invoicePurchaseOrderLine.mutateAsync(args)
    }
  }

  const defaultQuickForm = purchaseOrderFormConfig

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? defaultQuickForm}
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
