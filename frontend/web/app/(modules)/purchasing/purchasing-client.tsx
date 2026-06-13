"use client"

import { useEffect, useMemo, useState } from "react"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newPurchaseOrderForm,
  newPurchaseRequisitionForm,
  newPartnerBankForm,
  editPartnerBankForm,
  addPurchaseOrderLineForm,
  editPurchaseOrderLineForm,
  receivePurchaseOrderLineForm,
  invoicePurchaseOrderLineForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  purchaseOrdersTableConfig,
  purchaseOrderLinesTableConfig,
  purchaseRequisitionsTableConfig,
  csvImportForm,
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
  // Landed costs
  useLandedCosts,
  useDeleteLandedCost,
  useComputeLandedCosts,
  usePostLandedCosts,
  useApplyLandedCosts,
  useCancelLandedCost,
  // Supplier intake
  useSupplierIntakes,
  useDeleteSupplierIntake,
  useApproveSupplierIntake,
  useRejectSupplierIntake,
  useHoldSupplierIntake,
  // Bill creation
  useCreateBillFromPurchaseOrder,
  useLockPurchaseOrder,
  useUnlockPurchaseOrder,
  useUpdatePurchaseOrderLine,
  usePurchasingCsvImportMutations,
  usePartnerBanks,
  useUpdatePoReceiptStatus,
  useUpdatePoInvoiceStatus,
  useCreatePartnerBank,
  useUpdatePartnerBank,
  useDeletePartnerBank,
} from "@lumiere/query-hooks/hooks/purchasing"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useProducts, useUoms } from "@lumiere/query-hooks/hooks/inventory"
import { useDepartments } from "@lumiere/query-hooks/hooks/hr"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  contactRowsToVendorSelectOptions,
  pricelistRowsToSelectOptions,
  productRowsToSelectOptions,
  uomRowsToSelectOptions,
  purchaseOrderRowsToSelectOptions,
  purchaseOrderLineRowsToEditOptions,
  purchaseOrderLineRowsToReceiveOptions,
  purchaseOrderLineRowsToInvoiceOptions,
  partnerBankRowsToSelectOptions,
  departmentRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  toAddPurchaseOrderLineParams,
  toInvoicePoLineArgs,
  toReceivePoLineArgs,
  toUpdatePurchaseOrderLineParams,
} from "@/lib/purchasing-create-params"
import {
  toCreatePartnerBankParams,
  toUpdatePartnerBankParams,
} from "@/lib/purchasing-partner-bank-params"

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

function landedCostState(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function supplierIntakeState(row: Record<string, unknown>): string {
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
  initialPartnerBanks?: Record<string, unknown>[]
  initialDepartments?: Record<string, unknown>[]
  organizationId?: number
  /**
   * Resolved on the server from `account_journal` (active Purchase journal for this org’s company + its `default_account_id`).
   * Required for “create bill from PO” to run; omit when no suitable journal row exists.
   */
  purchaseBillJournalId?: string
  purchaseBillExpenseAccountId?: string
}

type PurchasingClientLoadedProps = Omit<PurchasingClientProps, "organizationId"> & {
  organizationId: number
}

type PurchasingCsvImportKind = "order" | "orderLine" | "supplierInfo"

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
  initialPartnerBanks,
  initialDepartments,
  organizationId,
  purchaseBillJournalId,
  purchaseBillExpenseAccountId,
}: PurchasingClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const moduleConfig = useMemo(() => purchasingModuleConfig(t), [t])
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? "dashboard",
    moduleConfig.tabs.map((t) => t.id),
  )
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(
    null,
  )
  const [formModalKey, setFormModalKey] = useState(0)
  const [csvKind, setCsvKind] = useState<PurchasingCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  useEffect(() => {
    if (quickActionForm != null) {
      setFormModalKey((k) => k + 1)
    }
  }, [quickActionForm])

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const { data: orders = [] } = usePurchaseOrders(orgId, initialOrders)
  const { data: lines = [] } = usePurchaseOrderLines(orgId, initialLines)
  const { data: requisitions = [] } = usePurchaseRequisitions(orgId, initialRequisitions)
  const { data: allContacts = [] } = useContacts(orgId, initialContacts)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: uoms = [] } = useUoms(orgId, initialUoms)
  const { data: landedCosts = [] } = useLandedCosts(orgId)
  const { data: supplierIntakes = [] } = useSupplierIntakes(orgId)
  const { data: partnerBanks = [] } = usePartnerBanks(orgId, initialPartnerBanks)
  const { data: departments = [] } = useDepartments(orgId, initialDepartments)

  const createPurchaseOrder = useCreatePurchaseOrder(orgId, { companyId: operatingCompanyId ?? undefined })
  const createPurchaseRequisition = useCreatePurchaseRequisition(orgId, { companyId: operatingCompanyId ?? undefined })
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

  // Landed costs mutations
  const deleteLandedCost = useDeleteLandedCost(orgId)
  const computeLandedCosts = useComputeLandedCosts(orgId)
  const postLandedCosts = usePostLandedCosts(orgId)
  const applyLandedCosts = useApplyLandedCosts(orgId, operatingCompanyId)
  const cancelLandedCost = useCancelLandedCost(orgId)

  // Supplier intake mutations
  const deleteSupplierIntake = useDeleteSupplierIntake(orgId)
  const approveSupplierIntake = useApproveSupplierIntake(orgId)
  const rejectSupplierIntake = useRejectSupplierIntake(orgId)
  const holdSupplierIntake = useHoldSupplierIntake(orgId)

  // Additional PO operations
  const lockPurchaseOrder = useLockPurchaseOrder(orgId)
  const unlockPurchaseOrder = useUnlockPurchaseOrder(orgId)
  const createBillFromPurchaseOrder = useCreateBillFromPurchaseOrder(orgId)
  const updatePurchaseOrderLine = useUpdatePurchaseOrderLine(orgId)
  const csvImports = usePurchasingCsvImportMutations(orgId, operatingCompanyId)

  const updatePoReceiptStatus = useUpdatePoReceiptStatus(orgId)
  const updatePoInvoiceStatus = useUpdatePoInvoiceStatus(orgId)
  const createPartnerBank = useCreatePartnerBank(orgId, { companyId: operatingCompanyId ?? undefined })
  const updatePartnerBank = useUpdatePartnerBank(orgId)
  const deletePartnerBank = useDeletePartnerBank(orgId)

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<PurchasingCsvImportKind, string> = {
      order: "purchasing.csvImport.ordersTitle",
      orderLine: "purchasing.csvImport.orderLinesTitle",
      supplierInfo: "purchasing.csvImport.supplierInfoTitle",
    }
    return csvImportForm(t, t(titleKey[csvKind]))
  }, [csvKind, t])

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

  const departmentFieldOptions = useMemo(() => {
    const fromApi = departmentRowsToSelectOptions(departments as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noDepartments"), disabled: true }]
  }, [departments, t])

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
        departmentId: departmentFieldOptions,
      }),
    [t, vendorFieldOptions, departmentFieldOptions],
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

  const editLineOptions = useMemo(
    () => purchaseOrderLineRowsToEditOptions(lines as Record<string, unknown>[], productLabel),
    [lines, productLabel],
  )

  const editLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editPurchaseOrderLineForm(t), {
        lineId: editLineOptions,
        productId: productFieldOptions,
        uomId: uomFieldOptions,
      }),
    [t, editLineOptions, productFieldOptions, uomFieldOptions],
  )

  const partnerBankFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPartnerBankForm(t), {
        partnerId: vendorFieldOptions,
      }),
    [t, vendorFieldOptions],
  )

  const partnerBankEditOptions = useMemo(
    () => partnerBankRowsToSelectOptions(partnerBanks as Record<string, unknown>[]),
    [partnerBanks],
  )

  const editPartnerBankFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editPartnerBankForm(t), {
        bankId: partnerBankEditOptions,
      }),
    [t, partnerBankEditOptions],
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
            id: "csv-purchase-orders",
            label: t("purchasing.csvImport.toolbarOrders"),
            onClick: () => setCsvKind("order"),
          },
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
          {
            id: "po-refresh-receipt-status",
            label: t("purchasing.actions.refreshReceiptStatus"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void updatePoReceiptStatus.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "po-refresh-invoice-status",
            label: t("purchasing.actions.refreshInvoiceStatus"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void updatePoInvoiceStatus.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "po-lock",
            label: t("purchasing.actions.lockSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void lockPurchaseOrder.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "po-unlock",
            label: t("purchasing.actions.unlockSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void unlockPurchaseOrder.mutateAsync(r.id as string | number | bigint)
              }
            },
          },
          {
            id: "po-create-bill",
            label: t("purchasing.actions.createBillsFromSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              const j = purchaseBillJournalId?.trim()
              const exp = purchaseBillExpenseAccountId?.trim()
              if (!j || !exp) return
              for (const r of rows) {
                const st = poState(r)
                if (st === "Approved" || st === "Done") {
                  void createBillFromPurchaseOrder.mutateAsync({
                    orderId: r.id as string | number | bigint,
                    journalId: j,
                    defaultExpenseAccountId: exp,
                    invoiceDate: new Date(),
                  })
                }
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
    updatePoReceiptStatus,
    updatePoInvoiceStatus,
    lockPurchaseOrder,
    unlockPurchaseOrder,
    createBillFromPurchaseOrder,
    purchaseBillJournalId,
    purchaseBillExpenseAccountId
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
            id: "csv-purchase-order-lines",
            label: t("purchasing.csvImport.toolbarOrderLines"),
            onClick: () => setCsvKind("orderLine"),
          },
          {
            id: "pol-add-form",
            label: t("purchasing.actions.addLineForm"),
            onClick: () =>
              setQuickActionForm({ form: addLineFormConfig, action: "addPurchaseOrderLine" }),
          },
          {
            id: "pol-edit-form",
            label: t("purchasing.actions.editLineForm"),
            onClick: () =>
              setQuickActionForm({ form: editLineFormConfig, action: "updatePurchaseOrderLine" }),
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
    editLineFormConfig,
    receiveLineFormConfig,
    invoiceLineFormConfig,
    removePurchaseOrderLine,
    receivePurchaseOrderLine
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

  const landedCostsEntityConfig = useMemo((): EntityViewConfig => {
    const view: EntityTableConfig = {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("purchasing.landedCosts.searchPlaceholder"),
      searchKeys: ["name", "description"],
      columns: [
        { key: "name", label: t("purchasing.landedCosts.columns.name"), width: "min-w-40" },
        { key: "state", label: t("purchasing.landedCosts.columns.state"), width: "min-w-24" },
        { key: "amountTotal", label: t("purchasing.landedCosts.columns.amountTotal"), type: "currency", align: "right" },
        { key: "vendorBillId", label: t("purchasing.landedCosts.columns.vendorBillId"), width: "min-w-24" },
      ],
      emptyMessage: t("purchasing.landedCosts.emptyMessage"),
      actions: [
        {
          id: "lc-compute",
          label: t("purchasing.actions.recalculateTotals"),
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              void computeLandedCosts.mutateAsync(r.id as string | number | bigint)
            }
          },
        },
        {
          id: "lc-post",
          label: t("purchasing.actions.postSelected"),
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              if (landedCostState(r) !== "Cancelled") {
                void postLandedCosts.mutateAsync(r.id as string | number | bigint)
              }
            }
          },
        },
        {
          id: "lc-apply",
          label: t("purchasing.actions.applySelected"),
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              void applyLandedCosts.mutateAsync({
                landedCostId: r.id as string | number | bigint,
              })
            }
          },
        },
        {
          id: "lc-cancel",
          label: t("purchasing.actions.cancelSelected"),
          requiresSelection: true,
          variant: "destructive",
          onClick: (rows) => {
            for (const r of rows) {
              if (landedCostState(r) !== "Cancelled") {
                void cancelLandedCost.mutateAsync(r.id as string | number | bigint)
              }
            }
          },
        },
        {
          id: "lc-delete",
          label: t("common.delete"),
          requiresSelection: true,
          variant: "destructive",
          onClick: (rows) => {
            for (const r of rows) {
              if (landedCostState(r) === "Draft") {
                void deleteLandedCost.mutateAsync(r.id as string | number | bigint)
              }
            }
          },
        },
      ],
    }
    return {
      id: "landed-costs-table",
      title: t("purchasing.landedCosts.title"),
      description: t("purchasing.landedCosts.description"),
      view,
    }
  }, [t, computeLandedCosts, postLandedCosts, applyLandedCosts, cancelLandedCost, deleteLandedCost])

  const supplierIntakesEntityConfig = useMemo((): EntityViewConfig => {
    const view: EntityTableConfig = {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("purchasing.supplierIntakes.searchPlaceholder"),
      searchKeys: ["reference", "notes"],
      columns: [
        { key: "reference", label: t("purchasing.supplierIntakes.columns.reference"), width: "min-w-36" },
        { key: "state", label: t("purchasing.supplierIntakes.columns.state"), width: "min-w-24" },
        { key: "requestedAt", label: t("purchasing.supplierIntakes.columns.requestedAt"), type: "date" },
        { key: "requestedBy", label: t("purchasing.supplierIntakes.columns.requestedBy"), width: "min-w-24" },
      ],
      emptyMessage: t("purchasing.supplierIntakes.emptyMessage"),
      actions: [
        {
          id: "si-approve",
          label: t("purchasing.actions.approveSelected"),
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              if (supplierIntakeState(r) === "Approved") continue
              const partnerRaw = r.partnerId ?? r.partner_id
              if (partnerRaw == null || partnerRaw === "" || Number(partnerRaw) <= 0) continue
              void approveSupplierIntake.mutateAsync({
                intakeId: r.id as string | number | bigint,
                partnerId: partnerRaw as string | number | bigint,
              })
            }
          },
        },
        {
          id: "si-reject",
          label: t("purchasing.actions.rejectSelected"),
          requiresSelection: true,
          variant: "destructive",
          onClick: (rows) => {
            for (const r of rows) {
              void rejectSupplierIntake.mutateAsync({
                intakeId: r.id as string | number | bigint,
                reason: "Rejected from purchasing UI",
              })
            }
          },
        },
        {
          id: "si-hold",
          label: t("purchasing.actions.holdSelected"),
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              void holdSupplierIntake.mutateAsync({
                intakeId: r.id as string | number | bigint,
                reason: "Held from purchasing UI",
              })
            }
          },
        },
        {
          id: "si-delete",
          label: t("common.delete"),
          requiresSelection: true,
          variant: "destructive",
          onClick: (rows) => {
            for (const r of rows) {
              void deleteSupplierIntake.mutateAsync(r.id as string | number | bigint)
            }
          },
        },
      ],
    }
    return {
      id: "supplier-intakes-table",
      title: t("purchasing.supplierIntakes.title"),
      description: t("purchasing.supplierIntakes.description"),
      view,
    }
  }, [t, approveSupplierIntake, rejectSupplierIntake, holdSupplierIntake, deleteSupplierIntake])

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
  }, [orders, moduleConfig, t, purchaseOrderFormConfig, purchaseRequisitionFormConfig, receiveLineFormConfig, setActiveTab])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: [
          ...moduleConfig.tabs.map((tab) => {
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
            if (tab.id === "vendors" && tab.type === "entity" && tab.entityConfig) {
              const base = tab.entityConfig
              const view = base.view as EntityTableConfig
              return {
                ...tab,
                entityConfig: {
                  ...base,
                  view: {
                    ...view,
                    rowSelectionToggleOnClick: false,
                    actions: [
                      {
                        id: "csv-supplier-info",
                        label: t("purchasing.csvImport.toolbarSupplierInfo"),
                        onClick: () => setCsvKind("supplierInfo"),
                      },
                      ...(view.actions ?? []),
                    ],
                  },
                },
              }
            }
            if (tab.id === "partner-banks" && tab.type === "entity" && tab.entityConfig) {
              const base = tab.entityConfig
              const view = base.view as EntityTableConfig
              return {
                ...tab,
                createForm: partnerBankFormConfig,
                entityConfig: {
                  ...base,
                  view: {
                    ...view,
                    actions: [
                      {
                        id: "pb-edit-form",
                        label: t("purchasing.partnerBanks.editForm"),
                        onClick: () =>
                          setQuickActionForm({
                            form: editPartnerBankFormConfig,
                            action: "updatePartnerBank",
                          }),
                      },
                      {
                        id: "pb-delete",
                        label: t("common.delete"),
                        requiresSelection: true,
                        variant: "destructive",
                        onClick: (rows: Record<string, unknown>[]) => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              t("purchasing.partnerBanks.deleteConfirm", { count: rows.length }),
                            )
                          ) {
                            return
                          }
                          for (const r of rows) {
                            void deletePartnerBank.mutateAsync(r.id as string | number | bigint)
                          }
                        },
                      },
                      ...(view.actions ?? []),
                    ],
                  },
                },
              }
            }
            return tab
          }),
          {
            id: "landed-costs",
            label: t("purchasing.landedCosts.title"),
            type: "entity",
            entityConfig: landedCostsEntityConfig,
          },
          {
            id: "supplier-intakes",
            label: t("purchasing.supplierIntakes.title"),
            type: "entity",
            entityConfig: supplierIntakesEntityConfig,
          },
        ],
      }) as ModuleConfig,
    [
      moduleConfig,
      liveSections,
      purchaseOrderFormConfig,
      purchaseRequisitionFormConfig,
      ordersEntityConfig,
      linesEntityConfig,
      requisitionsEntityConfig,
      landedCostsEntityConfig,
      supplierIntakesEntityConfig,
      partnerBankFormConfig,
      editPartnerBankFormConfig,
      deletePartnerBank,
      t,
    ],
  )

  const data = useMemo(
    () => ({
      orders: orders as unknown as Record<string, unknown>[],
      lines: lines as unknown as Record<string, unknown>[],
      requisitions: requisitions as unknown as Record<string, unknown>[],
      vendors: vendors as unknown as Record<string, unknown>[],
      "landed-costs": landedCosts as unknown as Record<string, unknown>[],
      "supplier-intakes": supplierIntakes as unknown as Record<string, unknown>[],
      "partner-banks": partnerBanks as unknown as Record<string, unknown>[],
    }),
    [orders, lines, requisitions, vendors, landedCosts, supplierIntakes, partnerBanks],
  )

  const handleFormSubmit = async (
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
      const selectedPricelistId = String(pricelistRaw)

      await createPurchaseOrder.mutateAsync({
        partnerId: Number(partnerRaw),
        currencyId: selectedPricelistId === String(pl.id) ? currencyId : currencyId,
        origin: formData.origin ? String(formData.origin) : undefined,
        partnerRef: formData.partnerRef ? String(formData.partnerRef) : undefined,
        notes: formData.notes ? String(formData.notes) : undefined,
        datePlanned: formData.datePlanned ? new Date(String(formData.datePlanned)) : undefined,
        paymentTermId:
          formData.paymentTermId != null && formData.paymentTermId !== ""
            ? Number(formData.paymentTermId)
            : undefined,
      })
    } else if (action === "createPurchaseRequisition") {
      const vendorRaw = formData.vendorId
      await createPurchaseRequisition.mutateAsync({
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
        vendorId:
          vendorRaw !== "" && vendorRaw != null ? Number(vendorRaw) : undefined,
        metadata: formData.origin
          ? JSON.stringify({ origin: String(formData.origin) })
          : undefined,
      })
    } else if (action === "addPurchaseOrderLine") {
      const params = toAddPurchaseOrderLineParams(formData)
      const orderId = formData.orderId
      if (params == null || orderId === "" || orderId == null) return
      await addPurchaseOrderLine.mutateAsync({
        orderId: orderId as string | number | bigint,
        params,
      })
    } else if (action === "updatePurchaseOrderLine") {
      const lineId = formData.lineId
      const params = toUpdatePurchaseOrderLineParams(formData)
      if (params == null || lineId === "" || lineId == null) return
      await updatePurchaseOrderLine.mutateAsync({
        lineId: lineId as string | number | bigint,
        params,
      })
    } else if (action === "receivePurchaseOrderLine") {
      const args = toReceivePoLineArgs(formData)
      if (args == null) return
      await receivePurchaseOrderLine.mutateAsync(args)
    } else if (action === "invoicePurchaseOrderLine") {
      const args = toInvoicePoLineArgs(formData)
      if (args == null) return
      await invoicePurchaseOrderLine.mutateAsync(args)
    } else if (action === "createPartnerBank") {
      const bankParams = toCreatePartnerBankParams(formData)
      if (bankParams) await createPartnerBank.mutateAsync(bankParams as Record<string, unknown>)
    } else if (action === "updatePartnerBank") {
      const u = toUpdatePartnerBankParams(formData)
      if (u) await updatePartnerBank.mutateAsync(u)
    }
  }

  const isFormMutationPending =
    createPurchaseOrder.isPending ||
    createPurchaseRequisition.isPending ||
    sendPurchaseOrder.isPending ||
    confirmPurchaseOrder.isPending ||
    cancelPurchaseOrder.isPending ||
    addPurchaseOrderLine.isPending ||
    removePurchaseOrderLine.isPending ||
    receivePurchaseOrderLine.isPending ||
    invoicePurchaseOrderLine.isPending ||
    submitPurchaseRequisition.isPending ||
    approvePurchaseRequisition.isPending ||
    closePurchaseRequisition.isPending ||
    cancelPurchaseRequisition.isPending ||
    computePoTotals.isPending ||
    computePoLineTotals.isPending ||
    deleteLandedCost.isPending ||
    computeLandedCosts.isPending ||
    postLandedCosts.isPending ||
    applyLandedCosts.isPending ||
    cancelLandedCost.isPending ||
    deleteSupplierIntake.isPending ||
    approveSupplierIntake.isPending ||
    rejectSupplierIntake.isPending ||
    holdSupplierIntake.isPending ||
    lockPurchaseOrder.isPending ||
    unlockPurchaseOrder.isPending ||
    createBillFromPurchaseOrder.isPending ||
    updatePurchaseOrderLine.isPending ||
    csvImports.importPurchaseOrder.isPending ||
    csvImports.importPurchaseOrderLine.isPending ||
    csvImports.importSupplierInfo.isPending ||
    createPartnerBank.isPending ||
    updatePartnerBank.isPending ||
    deletePartnerBank.isPending ||
    updatePoReceiptStatus.isPending ||
    updatePoInvoiceStatus.isPending

  const defaultQuickForm = purchaseOrderFormConfig

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        isPending={isFormMutationPending}
      />
      <FormModal
        key={formModalKey}
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? defaultQuickForm}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "order") await csvImports.importPurchaseOrder.mutateAsync(text)
              else if (csvKind === "orderLine") await csvImports.importPurchaseOrderLine.mutateAsync(text)
              else await csvImports.importSupplierInfo.mutateAsync(text)
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </>
  )
}
