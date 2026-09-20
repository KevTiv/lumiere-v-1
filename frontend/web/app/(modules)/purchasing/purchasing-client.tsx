"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useTranslation } from "@lumiere/i18n"
import { Badge } from "@lumiere/ui/components/badge"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  RuntimeFormModal,
  useRBAC,
  workflowActionsToEntityActions,
  EntityView,
  newPurchaseOrderForm,
  editPurchaseOrderForm,
  newPurchaseRequisitionForm,
  newPartnerBankForm,
  editPartnerBankForm,
  addPurchaseOrderLineForm,
  editPurchaseOrderLineForm,
  receivePurchaseOrderLineForm,
  invoicePurchaseOrderLineForm,
  newLandedCostForm,
  editLandedCostForm,
  addLandedCostLineForm,
  removeLandedCostLineForm,
  newSupplierIntakeForm,
  reviewSupplierIntakeForm,
  editSupplierIntakeForm,
  createBillFromPurchaseOrderForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  purchaseOrdersTableConfig,
  purchaseOrderDetailConfig,
  purchaseOrderStatusBadges,
  purchaseOrderLinesTableConfig,
  purchaseRequisitionsTableConfig,
  purchaseRfqsTableConfig,
  purchaseRfqBidsTableConfig,
  purchaseReturnsTableConfig,
  csvImportForm,
  RecordChatterDialog,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from "@lumiere/ui"
import type { EntityViewConfig, EntityTableConfig, EntityRecordSheetConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import type { Product, Uom } from "@lumiere/stdb/types"
import { purchasingModuleConfig } from "@/lib/module-dashboard-configs"
import { usePurchasingModuleSubscription } from "@/lib/module-subscription-hooks"
import { PurchasingOpsSod } from "./purchasing-ops-sod"
import { PurchasingBlanketWorkspace } from "./purchasing-blanket-workspace"
import {
  PurchasingOperationDialogs,
  type PurchasingOperationDialogRequest,
} from "./purchasing-operation-dialogs"
import { PurchasingConfigurationWorkspace } from "./purchasing-configuration-workspace"
import type { PurchasingConfigurationKind } from "./purchasing-configuration"
import {
  PurchasingIntakeReasonDialog,
  type PurchasingIntakeReasonKind,
} from "./purchasing-intake-reason-dialog"
import { RecordDocumentAttachments } from "../../../components/record-document-attachments"
import { chatterTargetFromRow, type ChatterTarget } from "@/lib/record-chatter"
import { groupBy } from "@/lib/utils"
import { useWorkflowSurface } from "@/hooks/use-workflow-surface"
import { usePurchasingWorkflow } from "@lumiere/query-hooks/hooks/purchasing-workflow"
import { recordRef, type TransitionNotice } from "@lumiere/erp-workflows"
import {
  usePurchaseOrders,
  usePurchaseOrdersToApprove,
  usePurchaseOrdersPartialReceipt,
  usePurchaseOrderLinesOverBilled,
  usePurchaseOrderLines,
  usePurchaseRequisitions,
  usePurchaseRfqs,
  usePurchaseRfqBids,
  usePurchaseReturns,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseRequisition,
  type ResPartnerBank,
  useCreatePurchaseOrder,
  useCreatePurchaseRequisition,
  useAddPurchaseOrderLine,
  useRemovePurchaseOrderLine,
  useInvoicePurchaseOrderLine,
  useUpdatePurchaseOrder,
  useComputePurchaseOrderTotals,
  useComputePurchaseOrderLineTotals,
  useContacts,
  // Landed costs
  useLandedCosts,
  useLandedCostLines,
  useCreateLandedCost,
  useUpdateLandedCost,
  useDeleteLandedCost,
  useAddLandedCostLine,
  useRemoveLandedCostLine,
  // Supplier intake
  useSupplierIntakes,
  useSubmitSupplierIntake,
  useUpdateSupplierIntake,
  useDeleteSupplierIntake,
  // Bill creation
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
  useCreatePurchaseRfq,
  useAddPurchaseRfqBid,
  useCreatePurchaseReturn,
  useCreatePurchaseBlanketOrder,
  usePurchaseBlanketOrders,
  usePurchaseBlanketOrderLines,
  usePurchaseBlanketReleases,
  useCreatePurchaseContract,
  useUpsertVendorScorecard,
  useSetVendorRiskFlag,
  useCreateConsignmentAgreement,
  useSetPurchaseApprovalDelegate,
  useSetCommodityPriceIndex,
  useCreatePurchasingIntegrationIntent,
  useRecordPurchasingIntegrationResult,
} from "@lumiere/query-hooks/hooks/purchasing"
import { usePricelists, type ProductPricelist } from "@lumiere/query-hooks/hooks/sales"
import type { Contact } from "@lumiere/query-hooks/hooks/crm"
import { useAccountAccounts, useAccountJournals, useAccountPaymentTerms } from "@lumiere/query-hooks/hooks/accounting"
import { useProducts, useUoms, useStockPickings, useWarehouses } from "@lumiere/query-hooks/hooks/inventory"
import { useDepartments, type HrDepartment } from "@lumiere/query-hooks/hooks/hr"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useRuntimeListConfig } from "@lumiere/ui/forms"
import {
  customFieldEntriesFromMetadata,
  findNewestRowByPartnerId,
  persistCustomFieldsToEav,
} from "@/lib/persist-record-custom-fields"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
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
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
  paymentTermRowsToSelectOptions,
  currencyOptionsFromRows,
} from "@/lib/form-lookup"
import {
  toAddLandedCostLineParams,
  toAddPurchaseOrderLineParams,
  toCreateBillFromPurchaseOrderParams,
  toCreateLandedCostParams,
  toCreatePurchaseOrderParams,
  toCreatePurchaseRequisitionParams,
  toInvoicePoLineArgs,
  toReceivePoLineArgs,
  toUpdateLandedCostParams,
  toUpdatePurchaseOrderLineParams,
} from "@/lib/purchasing-create-params"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import {
  toCreatePartnerBankParams,
  toUpdatePartnerBankParams,
} from "@/lib/purchasing-partner-bank-params"

/** Forms that render their own failure inline instead of a toast. */
const INLINE_ERROR_TRANSITIONS: ReadonlySet<string> = new Set(["purchasing.order.create-bill"])

/** Copy for the confirmation shown before destructive/confirm-kind workflow actions. */
const WORKFLOW_CONFIRMATION = (t: (key: string) => string) => ({
  description: t("erpWorkflow.confirm.description"),
  confirmLabel: t("erpWorkflow.confirm.confirm"),
  cancelLabel: t("erpWorkflow.confirm.dismiss"),
})

function poState(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function recordTimestampMs(row: Record<string, unknown>): number {
  const raw = row.writeDate ?? row.write_date ?? row.createDate ?? row.create_date
  if (raw == null) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e15 ? n / 1000 : n
}

function journalTypeTag(row: { type?: unknown; type_?: unknown }): string {
  const v = row.type_ ?? row.type
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function accountInternalTypeTag(row: Record<string, unknown>): string {
  const v = row.internalType ?? row.internal_type
  if (v != null && typeof v === "object" && "tag" in v) {
    return String((v as { tag: string }).tag).toLowerCase()
  }
  return String(v ?? "").toLowerCase()
}

function accountInternalGroupTag(row: Record<string, unknown>): string {
  const v = row.internalGroup ?? row.internal_group
  if (v != null && typeof v === "object" && "tag" in v) {
    return String((v as { tag: string }).tag).toLowerCase()
  }
  return String(v ?? "").toLowerCase()
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

function optionalFormString(v: unknown): string | undefined {
  if (v == null || v === "") return undefined
  return String(v)
}

function draftLandedCostRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows
    .filter((r) => landedCostState(r) === "Draft")
    .map((row) => ({
      value: String(row.id),
      label: String(row.description ?? `Landed cost ${row.id}`),
    }))
}

function supplierIntakeRowsToSelectOptions(
  rows: Record<string, unknown>[],
  opts?: { reviewableOnly?: boolean },
): Array<{ value: string; label: string }> {
  const list =
    opts?.reviewableOnly === true
      ? rows.filter((r) => {
          const st = supplierIntakeState(r)
          return st === "Submitted" || st === "OnHold"
        })
      : rows.filter((r) => {
          const st = supplierIntakeState(r)
          return st !== "Approved" && st !== "Rejected" && st !== "Onboarded"
        })
  return list.map((row) => ({
    value: String(row.id),
    label: String(row.companyName ?? row.company_name ?? `Intake ${row.id}`),
  }))
}

function stockPickingRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? `Transfer ${row.id}`),
  }))
}

const PO_QTY_MATCH_TOLERANCE = 0.001

type PoLineMatchStatus =
  | "matched"
  | "pending"
  | "under_received"
  | "over_received"
  | "under_billed"
  | "over_billed"

function isDropshipPo(row: Record<string, unknown>): boolean {
  const origin = String(row.origin ?? "")
  if (origin.toLowerCase().startsWith("dropship:")) return true
  const metaRaw = row.metadata
  if (typeof metaRaw === "string" && metaRaw.trim()) {
    try {
      const parsed = JSON.parse(metaRaw) as Record<string, unknown>
      if (parsed.dropship === true) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

function matchStateFromMetadata(row: Record<string, unknown>): PoLineMatchStatus | null {
  const metaRaw = row.metadata
  if (typeof metaRaw !== "string" || !metaRaw.trim()) return null
  try {
    const parsed = JSON.parse(metaRaw) as Record<string, unknown>
    const state = String(parsed.match_state ?? "")
    if (
      state === "matched" ||
      state === "pending" ||
      state === "under_received" ||
      state === "over_received" ||
      state === "under_billed" ||
      state === "over_billed"
    ) {
      return state
    }
  } catch {
    /* ignore */
  }
  return null
}

function computeLineMatchState(
  row: Record<string, unknown>,
  tolerance = PO_QTY_MATCH_TOLERANCE,
): { status: PoLineMatchStatus; tooltip: string } {
  const fromMeta = matchStateFromMetadata(row)
  const ordered = Number(row.productQty ?? row.product_qty ?? 0)
  const received = Number(row.qtyReceived ?? row.qty_received ?? 0)
  const billed = Number(row.qtyInvoiced ?? row.qty_invoiced ?? 0)

  let status: PoLineMatchStatus = fromMeta ?? "pending"
  if (fromMeta == null) {
    if (received <= tolerance && billed <= tolerance) {
      status = "pending"
    } else if (received > ordered + tolerance) {
      status = "over_received"
    } else if (billed > received + tolerance || billed > ordered + tolerance) {
      status = "over_billed"
    } else if (Math.abs(received - billed) <= tolerance && received <= ordered + tolerance) {
      status = "matched"
    } else if (billed < received - tolerance) {
      status = "under_billed"
    } else if (received < ordered - tolerance) {
      status = "under_received"
    }
  }

  const variance =
    status === "over_billed" || status === "under_billed"
      ? billed - received
      : status === "over_received" || status === "under_received"
        ? received - ordered
        : 0

  const tooltipKey = `purchasing.orderLines.matchStatus.tooltips.${status}`
  const tooltip = variance !== 0 ? `${tooltipKey}:var=${variance.toFixed(4)}` : tooltipKey

  return { status, tooltip }
}

function poLineMatchBadges(t: (key: string) => string) {
  return {
    badgeVariants: {
      matched: "default",
      pending: "secondary",
      under_received: "outline",
      under_billed: "outline",
      over_received: "destructive",
      over_billed: "destructive",
    },
    badgeLabels: {
      matched: t("purchasing.orderLines.matchStatus.matched"),
      pending: t("purchasing.orderLines.matchStatus.pending"),
      under_received: t("purchasing.orderLines.matchStatus.under_received"),
      under_billed: t("purchasing.orderLines.matchStatus.under_billed"),
      over_received: t("purchasing.orderLines.matchStatus.over_received"),
      over_billed: t("purchasing.orderLines.matchStatus.over_billed"),
    },
  } as const
}

function poLineMatchTooltip(t: (key: string, opts?: Record<string, unknown>) => string, raw: string): string {
  const [key, variancePart] = raw.split(":var=")
  if (variancePart != null) {
    return t(key, { variance: variancePart })
  }
  return t(key)
}

interface PurchasingClientProps {
  initialOrders?: PurchaseOrder[]
  initialLines?: PurchaseOrderLine[]
  initialRequisitions?: PurchaseRequisition[]
  initialContacts?: Contact[]
  initialPricelists?: ProductPricelist[]
  initialProducts?: Product[]
  initialUoms?: Uom[]
  initialPartnerBanks?: ResPartnerBank[]
  initialDepartments?: HrDepartment[]
  organizationId?: number
}

type PurchasingClientLoadedProps = Omit<PurchasingClientProps, "organizationId"> & {
  organizationId: number
  operatingCompanyId: bigint
}

type PurchasingClientWithCompanyProps = Omit<PurchasingClientLoadedProps, "operatingCompanyId">

type PurchasingCsvImportKind = "order" | "orderLine" | "supplierInfo"

export function PurchasingClient(props: PurchasingClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <PurchasingClientWithCompany {...props} organizationId={props.organizationId} />
}

function PurchasingClientWithCompany(props: PurchasingClientWithCompanyProps) {
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(props.organizationId)
  if (operatingCompanyId == null || operatingCompanyId <= 0n) {
    return <MissingOrganization />
  }
  return <PurchasingClientLoaded {...props} operatingCompanyId={operatingCompanyId} />
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
  operatingCompanyId,
}: PurchasingClientLoadedProps) {
  usePurchasingModuleSubscription()
  const { t } = useTranslation()
  const { currentUser } = useRBAC()
  const runtimeRoleId = currentUser?.roles[0]
  const { orgId } = orgBigInts(organizationId)

  const purchaseOrdersTableRuntime = useRuntimeListConfig({
    base: purchaseOrdersTableConfig(t).view as EntityTableConfig,
    moduleId: "purchasing",
    formId: "new-purchase-order",
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:purchasing:orders:${organizationId}`,
  })
  const moduleConfig = useMemo(() => purchasingModuleConfig(t), [t])
  const purchasingTabIds = useMemo(
    () => [...moduleConfig.tabs.map((tab) => tab.id), "rfqs", "rfq-bids", "purchase-returns", "landed-costs", "supplier-intakes", "blanket-orders"],
    [moduleConfig],
  )
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? "dashboard",
    purchasingTabIds,
  )
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(
    null,
  )
  const [landedCostDetailRow, setLandedCostDetailRow] = useState<Record<string, unknown> | null>(
    null,
  )
  const [formModalKey, setFormModalKey] = useState(0)
  const [csvKind, setCsvKind] = useState<PurchasingCsvImportKind | null>(null)
  const [billOrderId, setBillOrderId] = useState<bigint | null>(null)
  const [billOrderError, setBillOrderError] = useState<string | null>(null)
  const [chatterTarget, setChatterTarget] = useState<ChatterTarget | null>(null)
  const [dashboardTimeRange, setDashboardTimeRange] = useState<TimeRangeValue>("30d")
  const [blanketActionRequest, setBlanketActionRequest] = useState<{
    kind: "create" | "release"
    token: number
  } | null>(null)
  const [operationDialogRequest, setOperationDialogRequest] =
    useState<PurchasingOperationDialogRequest | null>(null)
  const [configurationActionRequest, setConfigurationActionRequest] = useState<{
    kind: PurchasingConfigurationKind
    token: number
  } | null>(null)
  const [intakeReasonRequest, setIntakeReasonRequest] = useState<{
    kind: PurchasingIntakeReasonKind
    row: Record<string, unknown>
  } | null>(null)
  const [intakeReasonError, setIntakeReasonError] = useState<string | null>(null)

  useEffect(() => {
    if (quickActionForm != null) {
      setFormModalKey((k) => k + 1)
    }
  }, [quickActionForm])

  const { data: orders = [], isLoading: ordersLoading } = usePurchaseOrders(orgId, initialOrders)
  const { data: ordersToApprove = [] } = usePurchaseOrdersToApprove(orgId)
  const { data: ordersPartialReceipt = [] } = usePurchaseOrdersPartialReceipt(orgId)
  const { data: linesOverBilled = [] } = usePurchaseOrderLinesOverBilled(orgId)
  const { data: lines = [] } = usePurchaseOrderLines(orgId, initialLines)
  const { data: requisitions = [] } = usePurchaseRequisitions(orgId, initialRequisitions)
  const { data: allContacts = [] } = useContacts(orgId, initialContacts)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: uoms = [] } = useUoms(orgId, initialUoms)
  const { data: stockPickings = [] } = useStockPickings(orgId)
  const { data: landedCosts = [] } = useLandedCosts(orgId)
  const { data: landedCostLines = [] } = useLandedCostLines(orgId)
  const { data: supplierIntakes = [] } = useSupplierIntakes(orgId)
  const { data: rfqs = [] } = usePurchaseRfqs(orgId)
  const { data: rfqBids = [] } = usePurchaseRfqBids(orgId)
  const { data: purchaseReturns = [] } = usePurchaseReturns(orgId)
  const { data: partnerBanks = [] } = usePartnerBanks(orgId, initialPartnerBanks)
  const { data: departments = [] } = useDepartments(orgId, initialDepartments)
  const { data: accountJournals = [] } = useAccountJournals(orgId)
  const { data: accountAccounts = [] } = useAccountAccounts(orgId)
  const { data: paymentTerms = [] } = useAccountPaymentTerms(orgId)
  const { data: currencies = [] } = useCurrencies()
  const { data: blanketOrders = [] } = usePurchaseBlanketOrders(orgId)
  const { data: blanketOrderLines = [] } = usePurchaseBlanketOrderLines(orgId)
  const { data: blanketReleases = [] } = usePurchaseBlanketReleases(orgId)
  const { data: warehouses = [] } = useWarehouses(orgId)

  const createPurchaseOrder = useCreatePurchaseOrder(orgId, { companyId: operatingCompanyId ?? undefined })
  const createPurchaseRequisition = useCreatePurchaseRequisition(orgId, { companyId: operatingCompanyId ?? undefined })
  const workflowSurface = useWorkflowSurface({ organizationId })
  const purchasingWorkflow = usePurchasingWorkflow(
    orgId,
    operatingCompanyId,
    {
      submitRequisition: t("purchasing.actions.submitSelected"),
      approveRequisition: t("purchasing.actions.approveSelected"),
      convertRequisition: t("purchasing.actions.convertToPo", { defaultValue: "Convert to PO" }),
      closeRequisition: t("purchasing.actions.closeSelected"),
      cancelRequisition: t("purchasing.actions.cancelRequisitions"),
      sendOrder: t("purchasing.actions.sendSelected"),
      confirmOrder: t("purchasing.actions.confirmSelected"),
      cancelOrder: t("purchasing.actions.cancelSelected"),
      createBill: t("purchasing.actions.createBillsFromSelected"),
      receiveLine: t("purchasing.actions.receiveFullOpenQty"),
      awardBid: t("purchasing.ops.awardRfqBid", { defaultValue: "Award RFQ bid" }),
      reviewIntake: t("purchasing.actions.reviewSelected", { defaultValue: "Start review" }),
      approveIntake: t("purchasing.actions.approveSelected"),
      holdIntake: t("purchasing.actions.holdSelected"),
      rejectIntake: t("purchasing.actions.rejectSelected"),
      // Table row actions collect an operator-authored reason before executing.
      holdIntakeReason: "",
      rejectIntakeReason: "",
      computeLandedCost: t("purchasing.actions.recalculateTotals"),
      postLandedCost: t("purchasing.actions.postSelected"),
      applyLandedCost: t("purchasing.actions.applySelected"),
      cancelLandedCost: t("purchasing.actions.cancelSelected"),
      confirmReturn: t("purchasing.ops.confirmPurchaseReturn", { defaultValue: "Confirm purchase return" }),
      createVendorCredit: t("purchasing.ops.createVendorCredit", { defaultValue: "Create vendor credit" }),
      releaseBlanket: t("purchasing.blanketOrders.release", { defaultValue: "Release to PO" }),
    },
    {
      navigate: workflowSurface.navigate,
    record: workflowSurface.record,
      notify: (notice: TransitionNotice) => {
        // The bill form renders its own failure inline.
        if (notice.kind === "error" && INLINE_ERROR_TRANSITIONS.has(notice.transitionId)) return
        workflowSurface.notify(notice)
      },
    },
  )
  const addPurchaseOrderLine = useAddPurchaseOrderLine(orgId)
  const removePurchaseOrderLine = useRemovePurchaseOrderLine(orgId)
  const invoicePurchaseOrderLine = useInvoicePurchaseOrderLine(orgId)
  const updatePurchaseOrder = useUpdatePurchaseOrder(orgId, operatingCompanyId ?? undefined)
  const computePoTotals = useComputePurchaseOrderTotals(orgId)
  const computePoLineTotals = useComputePurchaseOrderLineTotals(orgId)

  // Landed costs mutations
  const createLandedCost = useCreateLandedCost(orgId, operatingCompanyId ?? undefined)
  const updateLandedCost = useUpdateLandedCost(orgId)
  const deleteLandedCost = useDeleteLandedCost(orgId)
  const addLandedCostLine = useAddLandedCostLine(orgId)
  const removeLandedCostLine = useRemoveLandedCostLine(orgId)

  // Supplier intake mutations
  const submitSupplierIntake = useSubmitSupplierIntake(orgId)
  const updateSupplierIntake = useUpdateSupplierIntake(orgId)
  const deleteSupplierIntake = useDeleteSupplierIntake(orgId)

  // Additional PO operations
  const lockPurchaseOrder = useLockPurchaseOrder(orgId)
  const unlockPurchaseOrder = useUnlockPurchaseOrder(orgId)
  const updatePurchaseOrderLine = useUpdatePurchaseOrderLine(orgId)
  const csvImports = usePurchasingCsvImportMutations(orgId, operatingCompanyId)

  const updatePoReceiptStatus = useUpdatePoReceiptStatus(orgId)
  const updatePoInvoiceStatus = useUpdatePoInvoiceStatus(orgId)
  const createPartnerBank = useCreatePartnerBank(orgId, {
    companyId: operatingCompanyId > 0n ? operatingCompanyId : undefined,
  })
  const updatePartnerBank = useUpdatePartnerBank(orgId)
  const deletePartnerBank = useDeletePartnerBank(orgId)

  // RFQ / purchase-return commands, presented through typed dialogs and list actions.
  const createPurchaseRfq = useCreatePurchaseRfq(orgId, operatingCompanyId)
  const addPurchaseRfqBid = useAddPurchaseRfqBid(orgId, operatingCompanyId)
  const createPurchaseReturn = useCreatePurchaseReturn(orgId, operatingCompanyId)

  // One-off advanced purchasing configuration commands.
  const createPurchaseBlanketOrder = useCreatePurchaseBlanketOrder(
    orgId,
    operatingCompanyId,
  )
  const createPurchaseContract = useCreatePurchaseContract(
    orgId,
    operatingCompanyId,
  )
  const upsertVendorScorecard = useUpsertVendorScorecard(
    orgId,
    operatingCompanyId,
  )
  const setVendorRiskFlag = useSetVendorRiskFlag(orgId, operatingCompanyId)
  const createConsignmentAgreement = useCreateConsignmentAgreement(
    orgId,
    operatingCompanyId,
  )
  const setPurchaseApprovalDelegate = useSetPurchaseApprovalDelegate(
    orgId,
    operatingCompanyId,
  )
  const setCommodityPriceIndex = useSetCommodityPriceIndex(
    orgId,
    operatingCompanyId,
  )
  const createPurchasingIntegrationIntent = useCreatePurchasingIntegrationIntent(
    orgId,
    operatingCompanyId,
  )
  const recordPurchasingIntegrationResult = useRecordPurchasingIntegrationResult(
    orgId,
    operatingCompanyId,
  )

  const openCreateRfqFromRequisition = async (requisitionId?: string) => {
    setOperationDialogRequest({ kind: "create-rfq", requisitionId })
  }

  const openAddRfqBid = async () => {
    setOperationDialogRequest({ kind: "add-rfq-bid" })
  }

  const promptAwardRfqBid = async () => {
    const rfqId = window
      .prompt(t("purchasing.ops.prompt.rfqId", { defaultValue: "RFQ id" }))
      ?.trim()
    const bidId = window
      .prompt(
        t("purchasing.ops.prompt.bidId", { defaultValue: "Bid id to award" }),
      )
      ?.trim()
    if (!rfqId || !bidId) return
    await purchasingWorkflow.awardBid.execute({ rfqId, bidId }, { navigateToNext: true })
  }

  const openCreatePurchaseReturn = async () => {
    setOperationDialogRequest({ kind: "create-purchase-return" })
  }

  const releaseBlanket = async (
    blanketOrderId: bigint,
    params: Parameters<typeof purchasingWorkflow.releaseBlanket.execute>[0]["params"],
  ) => {
    await purchasingWorkflow.releaseBlanket.execute(
      { blanketOrderId: String(blanketOrderId), params },
      { navigateToNext: true },
    )
  }

  const openPurchaseOrder = (purchaseOrderId: string) =>
    workflowSurface.navigate(recordRef("purchase_order", purchaseOrderId, "purchasing"))

  const openVendorCreditFromReturn = async () => {
    setOperationDialogRequest({ kind: "create-vendor-credit" })
  }

  const openBlanketOrderCreate = async () => {
    setBlanketActionRequest((current) => ({ kind: "create", token: (current?.token ?? 0) + 1 }))
  }

  const openBlanketRelease = async () => {
    setBlanketActionRequest((current) => ({ kind: "release", token: (current?.token ?? 0) + 1 }))
  }

  const openPurchaseReturns = async () => {
    setActiveTab("purchase-returns")
  }

  const openPurchasingConfiguration = async (kind: PurchasingConfigurationKind) => {
    setConfigurationActionRequest((current) => ({
      kind,
      token: (current?.token ?? 0) + 1,
    }))
  }

  const promptCreatePurchaseContract = async () => {
    const name =
      window
        .prompt(
          t("purchasing.ops.prompt.contractName", {
            defaultValue: "Purchase contract name",
          }),
        )
        ?.trim() ?? ""
    const partnerId =
      window
        .prompt(
          t("purchasing.ops.prompt.partnerId", { defaultValue: "Vendor partner id" }),
        )
        ?.trim() ?? ""
    if (!name || !partnerId) return
    await createPurchaseContract.mutateAsync({
      name,
      partnerId: BigInt(partnerId),
      dateStart: null,
      dateEnd: null,
      metadata: null,
    })
  }

  const promptUpsertVendorScorecard = async () => {
    const partnerId =
      window
        .prompt(
          t("purchasing.ops.prompt.partnerId", { defaultValue: "Vendor partner id" }),
        )
        ?.trim() ?? ""
    const otifRaw =
      window.prompt(
        t("purchasing.ops.prompt.otifScore", {
          defaultValue: "OTIF score (0–100)",
        }),
        "95",
      ) ?? ""
    const qualityRaw =
      window.prompt(
        t("purchasing.ops.prompt.qualityScore", {
          defaultValue: "Quality score (0–100)",
        }),
        "90",
      ) ?? ""
    if (!partnerId) return
    const otifScore = Number(otifRaw)
    const qualityScore = Number(qualityRaw)
    if (!Number.isFinite(otifScore) || !Number.isFinite(qualityScore)) {
      throw new Error("Invalid score")
    }
    await upsertVendorScorecard.mutateAsync({
      partnerId: BigInt(partnerId),
      otifScore,
      qualityScore,
      metadata: null,
    })
  }

  const promptSetVendorRiskFlag = async () => {
    const partnerId =
      window
        .prompt(
          t("purchasing.ops.prompt.partnerId", { defaultValue: "Vendor partner id" }),
        )
        ?.trim() ?? ""
    const riskLevel =
      window
        .prompt(
          t("purchasing.ops.prompt.riskLevel", {
            defaultValue: "Risk level (e.g. low, medium, high)",
          }),
          "medium",
        )
        ?.trim() ?? ""
    if (!partnerId || !riskLevel) return
    await setVendorRiskFlag.mutateAsync({
      partnerId: BigInt(partnerId),
      isFlagged: true,
      riskLevel,
      reason: "set via Ops",
      metadata: null,
    })
  }

  const promptCreateConsignmentAgreement = async () => {
    const name =
      window
        .prompt(
          t("purchasing.ops.prompt.consignmentName", {
            defaultValue: "Consignment agreement name",
          }),
        )
        ?.trim() ?? ""
    const partnerId =
      window
        .prompt(
          t("purchasing.ops.prompt.partnerId", { defaultValue: "Vendor partner id" }),
        )
        ?.trim() ?? ""
    const productId =
      window
        .prompt(
          t("purchasing.ops.prompt.productId", { defaultValue: "Product id" }),
        )
        ?.trim() ?? ""
    const warehouseId =
      window
        .prompt(
          t("purchasing.ops.prompt.warehouseId", { defaultValue: "Warehouse id" }),
        )
        ?.trim() ?? ""
    if (!name || !partnerId || !productId || !warehouseId) return
    await createConsignmentAgreement.mutateAsync({
      name,
      partnerId: BigInt(partnerId),
      productId: BigInt(productId),
      warehouseId: BigInt(warehouseId),
      metadata: null,
    })
  }

  const promptSetApprovalDelegate = async () => {
    const principalIdentity =
      window
        .prompt(
          t("purchasing.ops.prompt.principalIdentity", {
            defaultValue: "Principal identity hex (64 chars)",
          }),
        )
        ?.trim() ?? ""
    const delegateIdentity =
      window
        .prompt(
          t("purchasing.ops.prompt.delegateIdentity", {
            defaultValue: "Delegate identity hex (64 chars)",
          }),
        )
        ?.trim() ?? ""
    if (!principalIdentity || !delegateIdentity) return
    await setPurchaseApprovalDelegate.mutateAsync({
      principalIdentity,
      delegateIdentity,
      isActive: true,
      metadata: null,
    })
  }

  const promptSetCommodityPriceIndex = async () => {
    const code =
      window
        .prompt(
          t("purchasing.ops.prompt.commodityCode", {
            defaultValue: "Commodity code (e.g. WTI, CU)",
          }),
        )
        ?.trim() ?? ""
    const rateRaw =
      window.prompt(
        t("purchasing.ops.prompt.commodityRate", {
          defaultValue: "Rate",
        }),
        "1",
      ) ?? ""
    if (!code) return
    const rate = Number(rateRaw)
    if (!Number.isFinite(rate)) throw new Error("Invalid rate")
    await setCommodityPriceIndex.mutateAsync({
      code,
      rate,
      asOf: new Date(),
      metadata: null,
    })
  }

  const promptCreateIntegrationIntent = async () => {
    const provider =
      window
        .prompt(
          t("purchasing.ops.prompt.intentProvider", {
            defaultValue: "Provider (e.g. customs, e-invoice)",
          }),
          "customs",
        )
        ?.trim() ?? ""
    const intentType =
      window
        .prompt(
          t("purchasing.ops.prompt.intentType", {
            defaultValue: "Intent type (e.g. submit, declare)",
          }),
          "submit",
        )
        ?.trim() ?? ""
    const orderRaw =
      window
        .prompt(
          t("purchasing.ops.prompt.intentPoId", {
            defaultValue: "Purchase order id (optional)",
          }),
        )
        ?.trim() ?? ""
    const idempotencyKey =
      window
        .prompt(
          t("purchasing.ops.prompt.idempotencyKey", {
            defaultValue: "Idempotency key",
          }),
          `pur-intent-${Date.now()}`,
        )
        ?.trim() ?? ""
    if (!provider || !intentType || !idempotencyKey) return
    await createPurchasingIntegrationIntent.mutateAsync({
      provider,
      intentType,
      purchaseOrderId: orderRaw ? BigInt(orderRaw) : null,
      idempotencyKey,
      requestPayload: null,
      metadata: null,
    })
  }

  const promptRecordIntegrationResult = async () => {
    const intentId =
      window
        .prompt(
          t("purchasing.ops.prompt.intentId", {
            defaultValue: "Integration intent id",
          }),
        )
        ?.trim() ?? ""
    const status =
      window
        .prompt(
          t("purchasing.ops.prompt.intentStatus", {
            defaultValue: "Status (e.g. succeeded, failed)",
          }),
          "succeeded",
        )
        ?.trim() ?? ""
    if (!intentId || !status) return
    const externalReference =
      window
        .prompt(
          t("purchasing.ops.prompt.externalRef", {
            defaultValue: "External reference (optional)",
          }),
        )
        ?.trim() || null
    await recordPurchasingIntegrationResult.mutateAsync({
      intentId,
      params: {
        status,
        externalReference,
        lastError: status === "failed" ? "recorded via Ops" : null,
        metadata: null,
      },
    })
  }

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

  const purchaseJournalFieldOptions = useMemo(() => {
    const purchaseRows = accountJournals.filter(
      (row) => journalTypeTag(row) === "Purchase" && row.active !== false,
    )
    const fromApi = accountJournalRowsToSelectOptions(purchaseRows)
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("purchasing.forms.createBillFromOrder.noJournals"),
        disabled: true,
      },
    ]
  }, [accountJournals, t])

  const expenseAccountFieldOptions = useMemo(() => {
    const expenseRows = (accountAccounts as Record<string, unknown>[]).filter(
      (row) => accountInternalGroupTag(row) === "expense",
    )
    const fromApi = accountAccountRowsToSelectOptions(
      expenseRows,
    )
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("purchasing.forms.createBillFromOrder.noAccounts"),
        disabled: true,
      },
    ]
  }, [accountAccounts, t])

  const payableAccountFieldOptions = useMemo(() => {
    const payableRows = (accountAccounts as Record<string, unknown>[]).filter(
      (row) => accountInternalTypeTag(row) === "payable",
    )
    const fromApi = accountAccountRowsToSelectOptions(payableRows)
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("purchasing.forms.createBillFromOrder.noPayableAccounts"),
        disabled: true,
      },
    ]
  }, [accountAccounts, t])

  const createBillFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(createBillFromPurchaseOrderForm(t), {
        journalId: purchaseJournalFieldOptions,
        defaultExpenseAccountId: expenseAccountFieldOptions,
        payableAccountId: payableAccountFieldOptions,
      }),
    [t, purchaseJournalFieldOptions, expenseAccountFieldOptions, payableAccountFieldOptions],
  )

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noUoms"), disabled: true }]
  }, [uoms, t])

  const paymentTermFieldOptions = useMemo(() => {
    const fromApi = paymentTermRowsToSelectOptions(paymentTerms as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: "—" }]
  }, [paymentTerms])

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
        paymentTermId: paymentTermFieldOptions,
      }),
    [t, vendorFieldOptions, pricelistFieldOptions, paymentTermFieldOptions],
  )

  const openCreatePurchaseOrder = useCallback(
    () =>
      setQuickActionForm({ form: purchaseOrderFormConfig, action: "createPurchaseOrder" }),
    [purchaseOrderFormConfig],
  )

  const vendorLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const vendor of vendors) {
      map.set(String(vendor.id), String(vendor.name ?? vendor.displayName ?? vendor.id))
    }
    return map
  }, [vendors])

  const purchaseOrderRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = purchaseOrderStatusBadges(t)
    const linesConfig = purchaseOrderLinesTableConfig(t)
    const baseDetail = purchaseOrderDetailConfig(t)
    const detailConfig = {
      ...baseDetail,
      sections: baseDetail.sections.map((section) =>
        section.id === "vendor"
          ? {
              ...section,
              fields: section.fields.map((field) =>
                field.key === "partnerId"
                  ? {
                      ...field,
                      render: (_value: unknown, record: Record<string, unknown>) => {
                        const partnerId = record.partnerId ?? record.partner_id
                        if (partnerId == null) return "—"
                        return (
                          vendorLabelById.get(String(partnerId)) ?? `Vendor ${String(partnerId)}`
                        )
                      },
                    }
                  : field,
              ),
            }
          : section,
      ),
    }
    return {
      titleKey: "name",
      statusKey: "state",
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig,
      auditTableName: "purchase_order",
      customTabs: [
        {
          id: "lines",
          label: t("purchasing.orderLines.title"),
          content: (record) => {
            const orderId = String(record.id ?? "")
            const orderLines = (lines as Record<string, unknown>[]).filter(
              (line) => String(line.orderId ?? line.order_id) === orderId,
            )
            return (
              <EntityView
                config={{
                  ...linesConfig,
                  title: "",
                  description: undefined,
                }}
                data={orderLines}
                useCard={false}
              />
            )
          },
        },
      ],
    }
  }, [t, lines, vendorLabelById])

  const purchaseRequisitionFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPurchaseRequisitionForm(t), {
        vendorId: vendorFieldOptions,
        departmentId: departmentFieldOptions,
        productId: productFieldOptions,
        uomId: uomFieldOptions,
      }),
    [t, vendorFieldOptions, departmentFieldOptions, productFieldOptions, uomFieldOptions],
  )

  const editPurchaseOrderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editPurchaseOrderForm(t), {
        orderId: draftPoOptions,
        partnerId: vendorFieldOptions,
        paymentTermId: [
          { value: "", label: "—" },
          ...paymentTerms.map((pt) => ({
            value: String(pt.id),
            label: String(pt.name ?? pt.id),
          })),
        ],
      }),
    [t, draftPoOptions, vendorFieldOptions, paymentTerms],
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

  const currencyFieldOptions = useMemo(
    () => currencyOptionsFromRows(currencies),
    [currencies],
  )
  const defaultCurrencyId = currencyFieldOptions[0]?.value ?? ""
  const operationDialogOptions = useMemo(
    () => ({
      requisitions: (requisitions as Record<string, unknown>[]).map((row) => ({
        value: String(row.id ?? ""),
        label: String(row.name ?? row.origin ?? `Requisition ${String(row.id ?? "")}`),
      })),
      rfqs: (rfqs as Record<string, unknown>[]).map((row) => ({
        value: String(row.id ?? ""),
        label: String(row.name ?? `RFQ ${String(row.id ?? "")}`),
      })),
      vendors: vendorFieldOptions.filter((option) => option.value !== ""),
      products: productFieldOptions.filter((option) => option.value !== ""),
      uoms: uomFieldOptions.filter((option) => option.value !== ""),
      purchaseOrders: (orders as Record<string, unknown>[]).map((row) => ({
        value: String(row.id ?? ""),
        label: String(row.name ?? `Purchase order ${String(row.id ?? "")}`),
      })),
      purchaseReturns: purchaseReturns.map((row) => ({
        value: String(row.id ?? ""),
        label: String(row.name ?? `Purchase return ${String(row.id ?? "")}`),
      })),
      journals: purchaseJournalFieldOptions.filter((option) => option.value !== ""),
      expenseAccounts: expenseAccountFieldOptions.filter((option) => option.value !== ""),
      payableAccounts: payableAccountFieldOptions.filter((option) => option.value !== ""),
    }),
    [
      requisitions,
      rfqs,
      vendorFieldOptions,
      productFieldOptions,
      uomFieldOptions,
      orders,
      purchaseReturns,
      purchaseJournalFieldOptions,
      expenseAccountFieldOptions,
      payableAccountFieldOptions,
    ],
  )

  const partnerBankFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newPartnerBankForm(t), {
          partnerId: vendorFieldOptions,
          currencyId: currencyFieldOptions,
        }),
        { currencyId: defaultCurrencyId },
      ),
    [t, vendorFieldOptions, currencyFieldOptions, defaultCurrencyId],
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

  const stockPickingFieldOptions = useMemo(() => {
    const fromApi = stockPickingRowsToSelectOptions(stockPickings as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("purchasing.forms.newLandedCost.fields.pickingPlaceholder"), disabled: true }]
  }, [stockPickings, t])

  const draftLandedCostOptions = useMemo(
    () => draftLandedCostRowsToSelectOptions(landedCosts as Record<string, unknown>[]),
    [landedCosts],
  )

  const supplierIntakeOptions = useMemo(
    () => supplierIntakeRowsToSelectOptions(supplierIntakes as Record<string, unknown>[]),
    [supplierIntakes],
  )

  const reviewableSupplierIntakeOptions = useMemo(
    () =>
      supplierIntakeRowsToSelectOptions(supplierIntakes as Record<string, unknown>[], {
        reviewableOnly: true,
      }),
    [supplierIntakes],
  )

  const landedCostFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newLandedCostForm(t), {
          pickingId: stockPickingFieldOptions,
          currencyId: currencyFieldOptions,
        }),
        { currencyId: String(defaultCurrencyId) },
      ),
    [t, stockPickingFieldOptions, currencyFieldOptions, defaultCurrencyId],
  )

  const editLandedCostFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editLandedCostForm(t), {
        landedCostId: draftLandedCostOptions,
        currencyId: currencyFieldOptions,
      }),
    [t, draftLandedCostOptions, currencyFieldOptions],
  )

  const addLandedCostLineFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(addLandedCostLineForm(t), {
          landedCostId: draftLandedCostOptions,
          productId: productFieldOptions,
          currencyId: currencyFieldOptions,
        }),
        { currencyId: String(defaultCurrencyId) },
      ),
    [t, draftLandedCostOptions, productFieldOptions, currencyFieldOptions, defaultCurrencyId],
  )

  const removeLandedCostLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(removeLandedCostLineForm(t), {
        lineId: landedCostLines.map((line) => ({
          value: String(line.id ?? ""),
          label: `#${String(line.id ?? "")} · LC ${String(line.landedCostId ?? "")} · ${Number(line.priceUnit ?? 0).toLocaleString()}`,
        })),
      }),
    [t, landedCostLines],
  )

  const supplierIntakeFormConfig = useMemo(() => newSupplierIntakeForm(t), [t])

  const reviewSupplierIntakeFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(reviewSupplierIntakeForm(t), {
        intakeId: reviewableSupplierIntakeOptions,
      }),
    [t, reviewableSupplierIntakeOptions],
  )

  const editSupplierIntakeFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editSupplierIntakeForm(t), {
        intakeId: supplierIntakeOptions,
      }),
    [t, supplierIntakeOptions],
  )

  const ordersEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseOrdersTableConfig(t, { onEmptyAction: openCreatePurchaseOrder })
    const runtimeView = purchaseOrdersTableRuntime
    return {
      ...base,
      view: {
        ...runtimeView,
        emptyState: {
          ...runtimeView.emptyState,
          onAction: openCreatePurchaseOrder,
        },
        actions: [
          {
            id: "csv-purchase-orders",
            label: t("purchasing.csvImport.toolbarOrders"),
            onClick: () => setCsvKind("order"),
          },
          {
            id: "po-edit-header",
            label: t("purchasing.actions.editHeader", {
              defaultValue: "Edit header",
            }),
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first || poState(first) !== "Draft") return
              setQuickActionForm({
                form: mergeFieldDefaultValues(editPurchaseOrderFormConfig, {
                  orderId: String(first.id),
                  partnerId: String(first.partnerId ?? first.partner_id ?? ""),
                  origin: String(first.origin ?? ""),
                  partnerRef: String(first.partnerRef ?? first.partner_ref ?? ""),
                  notes: String(first.notes ?? ""),
                  paymentTermId: String(
                    first.paymentTermId ?? first.payment_term_id ?? "",
                  ),
                }),
                action: "updatePurchaseOrder",
              })
            },
          },
          // Legacy ids keep the existing e2e selectors while the actions run through the workflow seam.
          ...workflowActionsToEntityActions(purchasingWorkflow.orderActions, {
            ids: {
              "purchasing.order.send": "po-send",
              "purchasing.order.confirm": "po-confirm",
              "purchasing.order.cancel": "po-cancel",
            },
            confirmation: WORKFLOW_CONFIRMATION(t),
          }),
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
            isApplicable: (rows) =>
              rows.length === 1 && purchasingWorkflow.createBill.canPresent(rows[0] as Record<string, unknown>),
            onClick: (rows) => {
              if (rows.length !== 1) return
              if (!purchasingWorkflow.createBill.canPresent(rows[0] as Record<string, unknown>)) return
              const id = rows[0]?.id
              if (id == null) return
              setBillOrderError(null)
              setBillOrderId(BigInt(String(id)))
            },
          },
        ],
      },
    }
  }, [
    t,
    purchaseOrdersTableRuntime,
    openCreatePurchaseOrder,
    editPurchaseOrderFormConfig,
    purchasingWorkflow.orderActions,
    purchasingWorkflow.createBill,
    computePoTotals,
    computePoLineTotals,
    updatePoReceiptStatus,
    updatePoInvoiceStatus,
    lockPurchaseOrder,
    unlockPurchaseOrder,
    updatePurchaseOrderLine,
  ])

  const linesEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseOrderLinesTableConfig(t)
    const view = base.view as EntityTableConfig
    const matchBadges = poLineMatchBadges(t)
    return {
      ...base,
      view: {
        ...view,
        columns: [
          { key: "orderId", label: t("purchasing.orderLines.columns.orderId"), width: "min-w-24" },
          { key: "productId", label: t("purchasing.orderLines.columns.productId"), width: "min-w-40" },
          {
            key: "productQty",
            label: t("purchasing.orderLines.columns.productQty"),
            type: "number",
            align: "right",
          },
          {
            key: "qtyReceived",
            label: t("purchasing.orderLines.columns.qtyReceived"),
            type: "number",
            align: "right",
          },
          {
            key: "qtyInvoiced",
            label: t("purchasing.orderLines.columns.qtyBilled"),
            type: "number",
            align: "right",
          },
          {
            key: "matchStatus",
            label: t("purchasing.orderLines.columns.matchStatus"),
            type: "badge",
            ...matchBadges,
            render: (value, row) => {
              const status = String(value ?? "") as PoLineMatchStatus
              const variant = (matchBadges.badgeVariants[status] ?? "secondary") as
                | "default"
                | "secondary"
                | "destructive"
                | "outline"
              const label = matchBadges.badgeLabels[status] ?? status
              const tooltip = poLineMatchTooltip(
                t,
                String(row.matchTooltip ?? `purchasing.orderLines.matchStatus.tooltips.${status}`),
              )
              return (
                <span
                  title={tooltip}
                  className={
                    status === "over_billed" || status === "over_received"
                      ? "inline-flex rounded-md ring-2 ring-destructive/40"
                      : undefined
                  }
                >
                  <Badge variant={variant}>{label}</Badge>
                </span>
              )
            },
          },
          {
            key: "qtyToInvoice",
            label: t("purchasing.orderLines.columns.qtyToInvoice"),
            type: "number",
            align: "right",
          },
          {
            key: "priceUnit",
            label: t("purchasing.orderLines.columns.priceUnit"),
            type: "currency",
            align: "right",
          },
          {
            key: "priceSubtotal",
            label: t("purchasing.orderLines.columns.priceSubtotal"),
            type: "currency",
            align: "right",
          },
          {
            key: "state",
            label: t("purchasing.orderLines.columns.state"),
            type: "badge",
            width: "min-w-24",
            badgeVariants: {
              Draft: "secondary",
              Confirmed: "outline",
              Done: "default",
              Cancelled: "destructive",
            },
            badgeLabels: {
              Draft: t("purchasing.orderLines.states.Draft"),
              Confirmed: t("purchasing.orderLines.states.Confirmed"),
              Done: t("purchasing.orderLines.states.Done"),
              Cancelled: t("purchasing.orderLines.states.Cancelled"),
            },
          },
          { key: "datePlanned", label: t("purchasing.orderLines.columns.datePlanned"), type: "date" },
        ],
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
            isApplicable: (rows) => rows.length === 1 && purchasingWorkflow.receiveLine.canPresent(rows[0] as Record<string, unknown>),
            onClick: (rows) => {
              const first = rows[0] as Record<string, unknown> | undefined
              const receiveLine = purchasingWorkflow.receiveLine
              if (!first || !receiveLine.canPresent(first) || !receiveLine.prepare) return
              void receiveLine.execute(receiveLine.prepare(first), { navigateToNext: true }).catch(() => undefined)
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
    purchasingWorkflow.receiveLine,
  ])

  const requisitionsEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseRequisitionsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          // Legacy ids keep the existing e2e selectors while the actions run through the workflow seam.
          ...workflowActionsToEntityActions(purchasingWorkflow.requisitionActions, {
            ids: {
              "purchasing.requisition.submit": "req-submit",
              "purchasing.requisition.approve": "req-approve",
              "purchasing.requisition.convert": "req-convert-po",
              "purchasing.requisition.close": "req-close",
              "purchasing.requisition.cancel": "req-cancel",
            },
            confirmation: WORKFLOW_CONFIRMATION(t),
          }),
          {
            id: "req-create-rfq",
            label: t("purchasing.actions.createRfq", {
              defaultValue: "Create RFQ",
            }),
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first) return
              void openCreateRfqFromRequisition(String(first.id)).catch(
                (e: unknown) => {
                  window.alert(e instanceof Error ? e.message : String(e))
                },
              )
            },
          },
        ],
      },
    }
  }, [t, purchasingWorkflow.requisitionActions, openCreateRfqFromRequisition])

  const landedCostsEntityConfig = useMemo((): EntityViewConfig => {
    const view: EntityTableConfig = {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("purchasing.landedCosts.searchPlaceholder"),
      searchKeys: ["name", "description"],
      columns: [
        { key: "description", label: t("purchasing.landedCosts.columns.name"), width: "min-w-40" },
        { key: "state", label: t("purchasing.landedCosts.columns.state"), width: "min-w-24" },
        { key: "amountTotal", label: t("purchasing.landedCosts.columns.amountTotal"), type: "currency", align: "right" },
        { key: "vendorBillId", label: t("purchasing.landedCosts.columns.vendorBillId"), width: "min-w-24" },
      ],
      emptyMessage: t("purchasing.landedCosts.emptyMessage"),
      actions: [
        {
          id: "lc-manage-lines",
          label: t("purchasing.actions.manageLandedCostLines"),
          requiresSelection: true,
          onClick: (rows) => {
            const first = rows[0]
            if (!first) return
            setLandedCostDetailRow(first)
          },
        },
        {
          id: "lc-add-line-form",
          label: t("purchasing.actions.addLandedCostLineForm"),
          onClick: () =>
            setQuickActionForm({ form: addLandedCostLineFormConfig, action: "addLandedCostLine" }),
        },
        {
          id: "lc-remove-line-form",
          label: t("purchasing.actions.removeLandedCostLineForm"),
          onClick: () =>
            setQuickActionForm({ form: removeLandedCostLineFormConfig, action: "removeLandedCostLine" }),
        },
        {
          id: "lc-edit-form",
          label: t("purchasing.actions.editLandedCostForm"),
          onClick: () =>
            setQuickActionForm({ form: editLandedCostFormConfig, action: "updateLandedCost" }),
        },
        // Legacy ids keep the existing e2e selectors while the actions run through the workflow seam.
        ...workflowActionsToEntityActions(purchasingWorkflow.landedCostActions, {
          ids: {
            "purchasing.landed-cost.compute": "lc-compute",
            "purchasing.landed-cost.post": "lc-post",
            "purchasing.landed-cost.apply": "lc-apply",
            "purchasing.landed-cost.cancel": "lc-cancel",
          },
          confirmation: WORKFLOW_CONFIRMATION(t),
        }),
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
  }, [
    t,
    addLandedCostLineFormConfig,
    removeLandedCostLineFormConfig,
    editLandedCostFormConfig,
    purchasingWorkflow.landedCostActions,
    deleteLandedCost,
  ])

  const rfqBidsEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseRfqBidsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          ...workflowActionsToEntityActions([purchasingWorkflow.awardBid], {
            ids: { "purchasing.rfq.award": "rfq-award-bid" },
            confirmation: WORKFLOW_CONFIRMATION(t),
          }),
        ],
      },
    }
  }, [t, purchasingWorkflow.awardBid])

  const purchaseReturnsEntityConfig = useMemo((): EntityViewConfig => {
    const base = purchaseReturnsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          ...workflowActionsToEntityActions(purchasingWorkflow.purchaseReturnActions, {
            ids: { "purchasing.return.confirm": "purchase-return-confirm" },
            confirmation: WORKFLOW_CONFIRMATION(t),
          }),
          {
            id: "purchase-return-vendor-credit",
            label: t("purchasing.ops.createVendorCredit", { defaultValue: "Create vendor credit" }),
            requiresSelection: true,
            isApplicable: (rows) =>
              rows.length === 1 && purchasingWorkflow.createVendorCredit.canPresent(rows[0]),
            onClick: (rows) => {
              const row = rows[0]
              if (!row) return
              setOperationDialogRequest({
                kind: "create-vendor-credit",
                purchaseReturnId: String(row.id ?? ""),
              })
            },
          },
        ],
      },
    }
  }, [t, purchasingWorkflow.purchaseReturnActions, purchasingWorkflow.createVendorCredit])

  const supplierIntakesEntityConfig = useMemo((): EntityViewConfig => {
    const view: EntityTableConfig = {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchPlaceholder: t("purchasing.supplierIntakes.searchPlaceholder"),
      searchKeys: ["companyName", "email", "contactName", "notes"],
      columns: [
        { key: "companyName", label: t("purchasing.supplierIntakes.columns.companyName"), width: "min-w-36" },
        { key: "contactName", label: t("purchasing.supplierIntakes.columns.contactName"), width: "min-w-28" },
        { key: "state", label: t("purchasing.supplierIntakes.columns.state"), width: "min-w-24" },
        { key: "email", label: t("purchasing.supplierIntakes.columns.email"), width: "min-w-32" },
      ],
      emptyMessage: t("purchasing.supplierIntakes.emptyMessage"),
      actions: [
        {
          id: "si-review-form",
          label: t("purchasing.actions.reviewSupplierIntakeForm"),
          onClick: () =>
            setQuickActionForm({ form: reviewSupplierIntakeFormConfig, action: "reviewSupplierIntake" }),
        },
        {
          id: "si-edit-form",
          label: t("purchasing.actions.editSupplierIntakeForm"),
          onClick: () =>
            setQuickActionForm({ form: editSupplierIntakeFormConfig, action: "updateSupplierIntake" }),
        },
        ...workflowActionsToEntityActions(
          purchasingWorkflow.supplierIntakeActions.filter(
            (action) =>
              action.id !== "purchasing.supplier-intake.reject" &&
              action.id !== "purchasing.supplier-intake.hold",
          ),
          {
          ids: {
            "purchasing.supplier-intake.approve": "si-approve",
          },
          confirmation: WORKFLOW_CONFIRMATION(t),
          },
        ),
        ...(["hold", "reject"] as const).map((kind) => {
          const action = purchasingWorkflow.supplierIntakeActions.find(
            (candidate) => candidate.id === `purchasing.supplier-intake.${kind}`,
          )
          return {
            id: `si-${kind}`,
            label: action?.label ?? kind,
            requiresSelection: true,
            variant: kind === "reject" ? ("destructive" as const) : undefined,
            isApplicable: (rows: Record<string, unknown>[]) =>
              rows.length === 1 && action != null && action.canPresent(rows[0]),
            onClick: (rows: Record<string, unknown>[]) => {
              const row = rows[0]
              if (!row) return
              setIntakeReasonError(null)
              setIntakeReasonRequest({ kind, row })
            },
          }
        }),
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
  }, [
    t,
    reviewSupplierIntakeFormConfig,
    editSupplierIntakeFormConfig,
    purchasingWorkflow.supplierIntakeActions,
    deleteSupplierIntake,
  ])

  const liveSections = useMemo(() => {
    const { startMs, endMs } = timeRangeToMs(dashboardTimeRange)
    const previousRange = previousPeriodMs(dashboardTimeRange)
    const inCurrentRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), startMs, endMs)
    const inPreviousRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), previousRange.startMs, previousRange.endMs)

    const isOpenOrder = (o: Record<string, unknown>) =>
      String(o.state) !== "Done" && String(o.state) !== "Cancelled"
    const isConfirmedOrder = (o: Record<string, unknown>) =>
      String(o.state) === "Purchase" || String(o.state) === "Done"

    const openOrders = orders.filter((o) => isOpenOrder(o as Record<string, unknown>))
    const currentOpenOrders = openOrders.filter((o) => inCurrentRange(o as Record<string, unknown>))
    const previousOpenOrders = orders.filter(
      (o) => isOpenOrder(o as Record<string, unknown>) && inPreviousRange(o as Record<string, unknown>),
    )
    const spendMtd = orders
      .filter((o) => isConfirmedOrder(o as Record<string, unknown>) && inCurrentRange(o as Record<string, unknown>))
      .reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)
    const previousSpend = orders
      .filter((o) => isConfirmedOrder(o as Record<string, unknown>) && inPreviousRange(o as Record<string, unknown>))
      .reduce((s, o) => s + Number(o.amountTotal ?? 0), 0)
    const pendingReceipt = orders.filter((o) => o.receiptStatus === "pending").length
    const toApprove =
      ordersToApprove.length > 0
        ? ordersToApprove.length
        : orders.filter((o) => String(o.state) === "ToApprove").length
    const partialReceipt =
      ordersPartialReceipt.length > 0
        ? ordersPartialReceipt.length
        : orders.filter((o) => String(o.receiptStatus) === "partial")
            .length
    const overBilled =
      linesOverBilled.length > 0
        ? linesOverBilled.length
        : lines.filter((l) => {
            const state = String(
              (l as Record<string, unknown>).matchState ??
                (l as Record<string, unknown>).match_state ??
                "",
            )
            return state === "over_billed"
          }).length
    // MVP on-time: confirmed POs with date_planned that are fully received by planned date (or still open past planned).
    const confirmedWithPlan = orders.filter((o) => {
      if (!isConfirmedOrder(o as Record<string, unknown>)) return false
      const planned = Number(o.datePlanned ?? 0)
      return planned > 0
    })
    const onTimeCount = confirmedWithPlan.filter((o) => {
      const plannedMs = Number(o.datePlanned ?? 0) / 1000
      const receipt = String(o.receiptStatus ?? "")
      if (receipt === "full" || receipt === "received") return true
      if (plannedMs > 0 && Date.now() <= plannedMs) return true
      return false
    }).length
    const onTimePct =
      confirmedWithPlan.length > 0
        ? Math.round((onTimeCount / confirmedWithPlan.length) * 100)
        : null

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                {
                  label: t("purchasing.dashboard.openPOs"),
                  value: openOrders.length.toString(),
                  change: percentChange(currentOpenOrders.length, previousOpenOrders.length),
                  icon: "FileText",
                },
                {
                  label: t("purchasing.dashboard.spendMTD"),
                  value: `$${spendMtd.toLocaleString()}`,
                  change: percentChange(spendMtd, previousSpend),
                  icon: "DollarSign",
                },
                { label: t("purchasing.dashboard.pendingReceipt"), value: pendingReceipt.toString(), icon: "Truck" },
                { label: t("purchasing.dashboard.awaitingApproval"), value: toApprove.toString(), icon: "Clock" },
                {
                  label: t("purchasing.dashboard.partialReceipt", {
                    defaultValue: "Partial receipt",
                  }),
                  value: partialReceipt.toString(),
                  icon: "Package",
                },
                {
                  label: t("purchasing.dashboard.overBilled", {
                    defaultValue: "Over-billed lines",
                  }),
                  value: overBilled.toString(),
                  icon: "AlertTriangle",
                },
                {
                  label: t("purchasing.dashboard.onTimePct", {
                    defaultValue: "On-time (MVP)",
                  }),
                  value: onTimePct == null ? "—" : `${onTimePct}%`,
                  icon: "Gauge",
                },
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
            create_purchase_blanket_order: () => {
              void openBlanketOrderCreate().catch((e: unknown) => {
                window.alert(e instanceof Error ? e.message : String(e))
              })
            },
            create_purchase_contract: () => {
              void openPurchasingConfiguration("contract")
            },
            create_purchasing_integration_intent: () => {
              void openPurchasingConfiguration("integrationIntent")
            },
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
          })
  }, [
    orders,
    ordersToApprove,
    ordersPartialReceipt,
    linesOverBilled,
    lines,
    moduleConfig,
    t,
    purchaseOrderFormConfig,
    purchaseRequisitionFormConfig,
    receiveLineFormConfig,
    setActiveTab,
    openBlanketOrderCreate,
    openPurchasingConfiguration,
    dashboardTimeRange,
  ])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: [
          ...withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
            if (tab.id === "orders" && tab.type === "entity") {
              return {
                ...tab,
                entityConfig: ordersEntityConfig,
                createForm: purchaseOrderFormConfig,
                recordSheet: purchaseOrderRecordSheet,
              }
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
            id: "blanket-orders",
            label: t("purchasing.blanketOrders.tab", { defaultValue: "Blanket Orders" }),
            type: "custom" as const,
            customContent: (
              <PurchasingBlanketWorkspace
                blanketOrders={blanketOrders as Record<string, unknown>[]}
                blanketLines={blanketOrderLines as Record<string, unknown>[]}
                blanketReleases={blanketReleases as Record<string, unknown>[]}
                vendors={vendors as Record<string, unknown>[]}
                products={products as Record<string, unknown>[]}
                uoms={uoms as Record<string, unknown>[]}
                currencies={currencies as Record<string, unknown>[]}
                createBlanket={(params) => createPurchaseBlanketOrder.mutateAsync(params)}
                releaseBlanket={releaseBlanket}
                onOpenPurchaseOrder={openPurchaseOrder}
              />
            ),
          },
          {
            id: "rfqs",
            label: t("purchasing.rfqs.title"),
            type: "entity",
            entityConfig: purchaseRfqsTableConfig(t),
          },
          {
            id: "rfq-bids",
            label: t("purchasing.rfqBids.title"),
            type: "entity",
            entityConfig: rfqBidsEntityConfig,
          },
          {
            id: "purchase-returns",
            label: t("purchasing.purchaseReturns.title", { defaultValue: "Purchase returns" }),
            type: "entity",
            entityConfig: purchaseReturnsEntityConfig,
          },
          {
            id: "landed-costs",
            label: t("purchasing.landedCosts.title"),
            type: "entity",
            entityConfig: landedCostsEntityConfig,
            createForm: landedCostFormConfig,
            createAction: "createLandedCost",
          },
          {
            id: "supplier-intakes",
            label: t("purchasing.supplierIntakes.title"),
            type: "entity",
            entityConfig: supplierIntakesEntityConfig,
            createForm: supplierIntakeFormConfig,
            createAction: "submitSupplierIntake",
          },
        ],
      }) as ModuleConfig,
    [
      moduleConfig,
      liveSections,
      purchaseOrderFormConfig,
      purchaseRequisitionFormConfig,
      ordersEntityConfig,
      purchaseOrderRecordSheet,
      linesEntityConfig,
      requisitionsEntityConfig,
      landedCostsEntityConfig,
      rfqBidsEntityConfig,
      purchaseReturnsEntityConfig,
      supplierIntakesEntityConfig,
      landedCostFormConfig,
      supplierIntakeFormConfig,
      partnerBankFormConfig,
      blanketOrders,
      blanketOrderLines,
      blanketReleases,
      vendors,
      products,
      uoms,
      currencies,
      createPurchaseBlanketOrder,
      editPartnerBankFormConfig,
      deletePartnerBank,
      t,
    ],
  )

  const enrichedLines = useMemo(
    () =>
      (lines as Record<string, unknown>[]).map((line) => {
        const match = computeLineMatchState(line)
        return {
          ...line,
          matchStatus: match.status,
          matchTooltip: match.tooltip,
        }
      }),
    [lines],
  )

  const enrichedOrders = useMemo(
    () =>
      (orders as Record<string, unknown>[]).map((order) => {
        const dropship = isDropshipPo(order)
        const saleOrderId = (() => {
          const metaRaw = order.metadata
          if (typeof metaRaw === "string" && metaRaw.trim()) {
            try {
              const parsed = JSON.parse(metaRaw) as Record<string, unknown>
              if (parsed.sale_order_id != null) return String(parsed.sale_order_id)
            } catch {
              /* ignore */
            }
          }
          const origin = String(order.origin ?? "")
          const m = origin.match(/^dropship:SO\/(.+)$/i)
          return m?.[1] ?? null
        })()
        return {
          ...order,
          fulfillmentLabel: dropship ? "Dropship" : "Standard",
          dropshipSaleOrderRef: saleOrderId,
          originDisplay:
            dropship && saleOrderId
              ? `${String(order.origin ?? "dropship")} → SO ${saleOrderId}`
              : String(order.origin ?? ""),
        }
      }),
    [orders],
  )

  const data = useMemo(
    () => ({
      orders: enrichedOrders,
      lines: enrichedLines,
      requisitions: requisitions as unknown as Record<string, unknown>[],
      vendors: vendors as unknown as Record<string, unknown>[],
      rfqs: rfqs as unknown as Record<string, unknown>[],
      "rfq-bids": rfqBids as unknown as Record<string, unknown>[],
      "purchase-returns": purchaseReturns,
      "landed-costs": landedCosts as unknown as Record<string, unknown>[],
      "supplier-intakes": supplierIntakes as unknown as Record<string, unknown>[],
      "partner-banks": partnerBanks as unknown as Record<string, unknown>[],
    }),
    [enrichedOrders, enrichedLines, requisitions, vendors, rfqs, rfqBids, purchaseReturns, landedCosts, supplierIntakes, partnerBanks],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "updatePurchaseOrder") {
      const orderId = formData.orderId
      if (orderId === "" || orderId == null) return
      const params: Record<string, unknown> = {}
      if (formData.origin != null && String(formData.origin).trim() !== "") {
        params.origin = String(formData.origin).trim()
      }
      if (formData.partnerRef != null && String(formData.partnerRef).trim() !== "") {
        params.partnerRef = String(formData.partnerRef).trim()
      }
      if (formData.notes != null && String(formData.notes).trim() !== "") {
        params.notes = String(formData.notes).trim()
      }
      if (formData.partnerId != null && String(formData.partnerId).trim() !== "") {
        params.partnerId = BigInt(String(formData.partnerId))
      }
      if (formData.paymentTermId != null && String(formData.paymentTermId).trim() !== "") {
        params.paymentTermId = BigInt(String(formData.paymentTermId))
      }
      if (formData.datePlanned != null && String(formData.datePlanned).trim() !== "") {
        params.datePlanned = formData.datePlanned
      }
      await updatePurchaseOrder.mutateAsync({
        orderId: orderId as string | number | bigint,
        params,
      })
    } else if (action === "createPurchaseOrder") {
      const params = toCreatePurchaseOrderParams(
        formData,
        pricelists as Array<{ id: unknown; currencyId?: unknown }>,
      )
      if (params == null) return
      await createPurchaseOrder.mutateAsync(params)
      if (params.metadata && operatingCompanyId !== 0n) {
        const entries = customFieldEntriesFromMetadata(params.metadata)
        if (entries.length > 0) {
          const rows = await fetchQueryList(
            "/api/query/purchase-orders",
            "Failed to fetch purchase orders",
          )
          const row = findNewestRowByPartnerId(rows, params.partnerId)
          if (row?.id) {
            await persistCustomFieldsToEav({
              organizationId,
              companyId: operatingCompanyId,
              model: "purchase_order",
              recordId: BigInt(String(row.id)),
              metadata: params.metadata,
            })
          }
        }
      }
    } else if (action === "createPurchaseRequisition") {
      await createPurchaseRequisition.mutateAsync(toCreatePurchaseRequisitionParams(formData))
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
      await purchasingWorkflow.receiveLine.execute(
        {
          lineId: String(args.lineId),
          qty: args.qty,
          lotId: args.lotId == null ? undefined : String(args.lotId),
        },
        { navigateToNext: true },
      )
    } else if (action === "invoicePurchaseOrderLine") {
      const args = toInvoicePoLineArgs(formData)
      if (args == null) return
      await invoicePurchaseOrderLine.mutateAsync(args)
    } else if (action === "createPartnerBank") {
      const bankParams = toCreatePartnerBankParams(formData)
      if (bankParams) await createPartnerBank.mutateAsync(bankParams)
    } else if (action === "updatePartnerBank") {
      const u = toUpdatePartnerBankParams(formData)
      if (u) await updatePartnerBank.mutateAsync(u)
    } else if (action === "createLandedCost") {
      const params = toCreateLandedCostParams(formData)
      if (!params) return
      await createLandedCost.mutateAsync(params)
    } else if (action === "updateLandedCost") {
      const landedCostId = formData.landedCostId
      if (landedCostId === "" || landedCostId == null) return
      const params = toUpdateLandedCostParams(formData)
      if (!params) return
      await updateLandedCost.mutateAsync({
        landedCostId: landedCostId as string | number | bigint,
        params,
      })
    } else if (action === "addLandedCostLine") {
      const landedCostId = formData.landedCostId
      if (landedCostId === "" || landedCostId == null) return
      const params = toAddLandedCostLineParams(formData)
      if (!params) return
      await addLandedCostLine.mutateAsync({
        landedCostId: landedCostId as string | number | bigint,
        params,
      })
    } else if (action === "removeLandedCostLine") {
      const lineId = formData.lineId
      if (lineId === "" || lineId == null) return
      const line = landedCostLines.find((row) => String(row.id) === String(lineId))
      const landedCostId = line?.landedCostId
      if (landedCostId == null || String(landedCostId) === "") return
      await removeLandedCostLine.mutateAsync({
        landedCostId: landedCostId as string | number | bigint,
        lineId: lineId as string | number | bigint,
      })
    } else if (action === "submitSupplierIntake") {
      const companyName = formData.companyName
      const contactName = formData.contactName
      const email = formData.email
      if (!companyName || !contactName || !email) return
      await submitSupplierIntake.mutateAsync({
        companyName: String(companyName),
        contactName: String(contactName),
        email: String(email),
        phone: optionalFormString(formData.phone),
        website: optionalFormString(formData.website),
        industry: optionalFormString(formData.industry),
        notes: optionalFormString(formData.notes),
        productCategories: [],
        qualityCertificates: [],
        documents: [],
      })
    } else if (action === "reviewSupplierIntake") {
      const intakeId = formData.intakeId
      if (intakeId === "" || intakeId == null) return
      await purchasingWorkflow.reviewIntake.execute({
        intakeId: String(intakeId),
        notes: optionalFormString(formData.reviewerNotes),
      })
    } else if (action === "updateSupplierIntake") {
      const intakeId = formData.intakeId
      if (intakeId === "" || intakeId == null) return
      const params: Record<string, unknown> = {}
      const companyName = optionalFormString(formData.companyName)
      if (companyName != null) params.companyName = companyName
      const contactName = optionalFormString(formData.contactName)
      if (contactName != null) params.contactName = contactName
      const email = optionalFormString(formData.email)
      if (email != null) params.email = email
      const phone = optionalFormString(formData.phone)
      if (phone != null) params.phone = phone
      const notes = optionalFormString(formData.notes)
      if (notes != null) params.notes = notes
      if (Object.keys(params).length === 0) return
      await updateSupplierIntake.mutateAsync({
        intakeId: intakeId as string | number | bigint,
        params,
      })
    }
  }

  const isFormMutationPending =
    createPurchaseOrder.isPending ||
    updatePurchaseOrder.isPending ||
    createPurchaseRequisition.isPending ||
    purchasingWorkflow.isPending ||
    addPurchaseOrderLine.isPending ||
    removePurchaseOrderLine.isPending ||
    invoicePurchaseOrderLine.isPending ||
    computePoTotals.isPending ||
    computePoLineTotals.isPending ||
    createLandedCost.isPending ||
    updateLandedCost.isPending ||
    deleteLandedCost.isPending ||
    addLandedCostLine.isPending ||
    removeLandedCostLine.isPending ||
    submitSupplierIntake.isPending ||
    updateSupplierIntake.isPending ||
    deleteSupplierIntake.isPending ||
    lockPurchaseOrder.isPending ||
    unlockPurchaseOrder.isPending ||
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

  const openLandedCostLineForm = useCallback(
    (action: "addLandedCostLine" | "removeLandedCostLine", landedCostId?: string) => {
      if (action === "addLandedCostLine") {
        const form =
          landedCostId != null
            ? mergeFieldDefaultValues(addLandedCostLineFormConfig, { landedCostId })
            : addLandedCostLineFormConfig
        setLandedCostDetailRow(null)
        setQuickActionForm({ form, action })
        return
      }
      const linesForCost =
        landedCostId != null
          ? landedCostLines.filter((line) => String(line.landedCostId ?? "") === landedCostId)
          : landedCostLines
      const form = mergeSelectOptionsForFields(removeLandedCostLineForm(t), {
        lineId: linesForCost.map((line) => ({
          value: String(line.id ?? ""),
          label: `#${String(line.id ?? "")} · ${Number(line.priceUnit ?? 0).toLocaleString()}`,
        })),
      })
      setLandedCostDetailRow(null)
      setQuickActionForm({ form, action })
    },
    [addLandedCostLineFormConfig, landedCostLines, removeLandedCostLineForm, t],
  )

  const landedCostDetailLines = useMemo(() => {
    if (landedCostDetailRow == null) return []
    const costId = String(landedCostDetailRow.id ?? "")
    return landedCostLines.filter((line) => String(line.landedCostId ?? "") === costId)
  }, [landedCostDetailRow, landedCostLines])

  return (
    <>
      {(activeTab === "dashboard" || activeTab === "orders") && (
        <PurchasingOpsSod
          orders={enrichedOrders}
          ordersToApprove={
            ordersToApprove.length > 0
              ? (ordersToApprove as Record<string, unknown>[])
              : undefined
          }
          onCreatePurchaseRfq={() => openCreateRfqFromRequisition()}
          onAddPurchaseRfqBid={openAddRfqBid}
          onAwardPurchaseRfqBid={promptAwardRfqBid}
          onCreatePurchaseReturn={openCreatePurchaseReturn}
          onConfirmPurchaseReturn={openPurchaseReturns}
          onCreateVendorCreditFromReturn={openVendorCreditFromReturn}
          onCreateBlanketOrder={openBlanketOrderCreate}
          onReleaseBlanketToPo={openBlanketRelease}
          onCreatePurchaseContract={() => openPurchasingConfiguration("contract")}
          onUpsertVendorScorecard={() => openPurchasingConfiguration("scorecard")}
          onSetVendorRiskFlag={() => openPurchasingConfiguration("riskFlag")}
          onCreateConsignmentAgreement={() => openPurchasingConfiguration("consignment")}
          onSetApprovalDelegate={() => openPurchasingConfiguration("approvalDelegate")}
          onSetCommodityPriceIndex={() => openPurchasingConfiguration("commodityIndex")}
          onCreateIntegrationIntent={() => openPurchasingConfiguration("integrationIntent")}
          onRecordIntegrationResult={promptRecordIntegrationResult}
        >
          <>
            <PurchasingBlanketWorkspace
              embedded
              actionRequest={blanketActionRequest}
              blanketOrders={blanketOrders as Record<string, unknown>[]}
              blanketLines={blanketOrderLines as Record<string, unknown>[]}
              blanketReleases={blanketReleases as Record<string, unknown>[]}
              vendors={vendors as Record<string, unknown>[]}
              products={products as Record<string, unknown>[]}
              uoms={uoms as Record<string, unknown>[]}
              currencies={currencies as Record<string, unknown>[]}
              createBlanket={(params) => createPurchaseBlanketOrder.mutateAsync(params)}
              releaseBlanket={releaseBlanket}
              onOpenPurchaseOrder={openPurchaseOrder}
            />
            <PurchasingConfigurationWorkspace
              embedded
              actionRequest={configurationActionRequest}
              vendors={vendors as Record<string, unknown>[]}
              products={products as Record<string, unknown>[]}
              warehouses={warehouses as Record<string, unknown>[]}
              purchaseOrders={orders as Record<string, unknown>[]}
              onCreateContract={(params) => createPurchaseContract.mutateAsync(params)}
              onUpsertScorecard={(params) => upsertVendorScorecard.mutateAsync(params)}
              onSetRiskFlag={(params) => setVendorRiskFlag.mutateAsync(params)}
              onSetApprovalDelegate={(params) => setPurchaseApprovalDelegate.mutateAsync(params)}
              onSetCommodityIndex={(params) => setCommodityPriceIndex.mutateAsync(params)}
              onCreateConsignment={(params) => createConsignmentAgreement.mutateAsync(params)}
              onCreateIntegrationIntent={(params) => createPurchasingIntegrationIntent.mutateAsync(params)}
            />
          </>
        </PurchasingOpsSod>
      )}
      <ModuleView
        config={config}
        data={data}
        dataLoading={{ orders: ordersLoading }}
        onFormSubmit={handleFormSubmit}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        dashboardTimeRange={dashboardTimeRange}
        onDashboardTimeRangeChange={setDashboardTimeRange}
        isPending={isFormMutationPending}
        runtimeForms={{
          organizationId,
          roleId: runtimeRoleId,
        }}
        onRowClick={(tabId, row) => {
          const target = chatterTargetFromRow("purchasing", tabId, row)
          if (target) setChatterTarget(target)
        }}
      />
      <PurchasingOperationDialogs
        request={operationDialogRequest}
        defaultCurrencyId={defaultCurrencyId ? BigInt(defaultCurrencyId) : null}
        options={operationDialogOptions}
        t={t}
        onDismiss={() => setOperationDialogRequest(null)}
        onCreateRfq={(params) => createPurchaseRfq.mutateAsync(params)}
        onAddRfqBid={(params) => addPurchaseRfqBid.mutateAsync(params)}
        onCreatePurchaseReturn={(params) => createPurchaseReturn.mutateAsync(params)}
        onCreateVendorCredit={(input) =>
          purchasingWorkflow.createVendorCredit.execute(input, { navigateToNext: true })
        }
      />
      {intakeReasonRequest ? (
        <PurchasingIntakeReasonDialog
          kind={intakeReasonRequest.kind}
          open
          pending={purchasingWorkflow.isPending}
          error={intakeReasonError}
          intakeLabel={String(
            intakeReasonRequest.row.companyName ?? intakeReasonRequest.row.name ?? intakeReasonRequest.row.id ?? "",
          )}
          onOpenChange={(open) => {
            if (!open) {
              setIntakeReasonRequest(null)
              setIntakeReasonError(null)
            }
          }}
          onSubmit={async (reason) => {
            const action = purchasingWorkflow.supplierIntakeActions.find(
              (candidate) =>
                candidate.id === `purchasing.supplier-intake.${intakeReasonRequest.kind}`,
            )
            if (!action) return
            setIntakeReasonError(null)
            try {
              await action.execute({
                intakeId: String(intakeReasonRequest.row.id ?? ""),
                reason,
              })
              setIntakeReasonRequest(null)
            } catch (error) {
              setIntakeReasonError(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
      {chatterTarget ? (
        <>
          <RecordChatterDialog
            key={`${chatterTarget.resModel}-${chatterTarget.resId.toString()}`}
            open
            onOpenChange={(open) => {
              if (!open) setChatterTarget(null)
            }}
            organizationId={organizationId}
            resModel={chatterTarget.resModel}
            resId={chatterTarget.resId}
            recordTitle={chatterTarget.recordTitle}
          />
          <div className="mx-4 mb-4 max-w-3xl">
            <RecordDocumentAttachments
              organizationId={orgId}
              resModel={chatterTarget.resModel}
              resId={chatterTarget.resId}
              title={`Attachments — ${chatterTarget.recordTitle ?? chatterTarget.resModel}`}
            />
          </div>
        </>
      ) : null}
      <RuntimeFormModal
        key={formModalKey}
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        staticConfig={quickActionForm?.form ?? defaultQuickForm}
        moduleId="purchasing"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        preferStdbVisibility
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {csvKind && csvFormConfig ? (
        <CsvImportModal
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === "order") await csvImports.importPurchaseOrder.mutateAsync(text)
            else if (csvKind === "orderLine") await csvImports.importPurchaseOrderLine.mutateAsync(text)
            else await csvImports.importSupplierInfo.mutateAsync(text)
          }}
        />
      ) : null}
      {billOrderId != null ? (
        <RuntimeFormModal
          key={`bill-order-${billOrderId.toString()}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setBillOrderId(null)
              setBillOrderError(null)
            }
          }}
          staticConfig={createBillFormConfig}
          moduleId="purchasing"
          formId="create-bill-from-purchase-order"
          organizationId={organizationId}
          roleId={runtimeRoleId}
          preferStdbVisibility
          foldCustomFieldsIntoMetadata={false}
          closeOnSubmit={false}
          submitError={billOrderError}
          isPending={purchasingWorkflow.isPending}
          onSubmit={async (formData) => {
            setBillOrderError(null)
            const orderRow = (orders as Record<string, unknown>[]).find(
              (o) => String(o.id) === String(billOrderId),
            )
            const partnerId =
              orderRow?.partnerId != null ? BigInt(String(orderRow.partnerId)) : undefined
            const params = toCreateBillFromPurchaseOrderParams(formData, { partnerId })
            if (!params) {
              setBillOrderError(t("common.validation.required"))
              return
            }
            try {
              await purchasingWorkflow.createBill.execute(
                { orderId: String(billOrderId), params },
                { navigateToNext: true },
              )
              setBillOrderId(null)
            } catch (e) {
              setBillOrderError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      <Dialog open={landedCostDetailRow != null} onOpenChange={(open) => !open && setLandedCostDetailRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("purchasing.landedCostDetail.title")}</DialogTitle>
          </DialogHeader>
          {landedCostDetailRow ? (
            <div className="space-y-2 text-sm">
              <p>{String(landedCostDetailRow.description ?? `Landed cost ${landedCostDetailRow.id}`)}</p>
              <p>
                {t("purchasing.landedCostDetail.state")}: {landedCostState(landedCostDetailRow)}
              </p>
              <p>
                {t("purchasing.landedCostDetail.amountTotal")}:{" "}
                {Number(landedCostDetailRow.amountTotal ?? 0).toLocaleString()}
              </p>
              {landedCostDetailLines.length > 0 ? (
                <div className="space-y-1 pt-2">
                  <p className="font-medium">{t("purchasing.landedCostDetail.lines")}</p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-muted-foreground">
                    {landedCostDetailLines.map((line) => (
                      <li key={String(line.id ?? "")}>
                        #{String(line.id ?? "")} · product {String(line.productId ?? "—")} ·{" "}
                        {Number(line.priceUnit ?? 0).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground">{t("purchasing.landedCostDetail.noLines")}</p>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                openLandedCostLineForm("addLandedCostLine", String(landedCostDetailRow?.id ?? ""))
              }
            >
              {t("purchasing.landedCostDetail.addLine")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => openLandedCostLineForm("removeLandedCostLine")}
            >
              {t("purchasing.landedCostDetail.removeLine")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
