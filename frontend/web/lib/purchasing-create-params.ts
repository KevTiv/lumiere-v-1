/**
 * Map modular form values → SpacetimeDB reducer bodies for purchasing `/api/call/*`.
 */

import type {
  AddAccountMoveLineParams,
  AddLandedCostLineParams,
  CreateBillFromPurchaseOrderParams,
  CreateLandedCostParams,
  CreatePurchaseOrderParams,
  CreatePurchaseRequisitionParams,
  UpdateLandedCostParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { nullableBigIntU64, optionalBigIntU64, optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function requiredTimestampFromForm(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

function optionalTimestampFromForm(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

function checkboxFromForm(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return true
  if (raw === false || raw === 0 || raw === "0" || raw === "false") return false
  return fallback
}

function emptyMoveLineParams(accountId: bigint): AddAccountMoveLineParams {
  return {
    accountId,
    name: "",
    debit: 0,
    credit: 0,
    sequence: 0,
    quantity: 0,
    priceUnit: 0,
    discount: 0,
    taxIds: [],
    partnerId: undefined,
    productId: undefined,
    productUomId: undefined,
    productCategoryId: undefined,
    analyticAccountId: undefined,
    analyticTagIds: [],
    displayType: undefined,
    isDownpayment: false,
    excludeFromInvoiceTab: false,
    blocked: false,
    groupTaxId: undefined,
    taxLineId: undefined,
    taxGroupId: undefined,
    taxRepartitionLineId: undefined,
    taxAudit: undefined,
    reconcileModelId: undefined,
    paymentId: undefined,
    statementLineId: undefined,
    matchingNumber: undefined,
    matchingLabel: undefined,
    expectedPayDate: undefined,
    expectedPayDateCurrencyId: undefined,
    expectedPayDateAmount: 0,
    expectedPayDateResidual: 0,
    metadata: undefined,
  }
}

export function toCreateBillFromPurchaseOrderParams(
  formData: Record<string, unknown>,
  order?: { partnerId?: bigint },
): CreateBillFromPurchaseOrderParams | null {
  const journalId = nullableBigIntU64(formData.journalId)
  const defaultExpenseAccountId = nullableBigIntU64(formData.defaultExpenseAccountId)
  const payableAccountId = nullableBigIntU64(formData.payableAccountId)
  if (journalId == null || defaultExpenseAccountId == null || payableAccountId == null) {
    return null
  }

  const partnerId = order?.partnerId
  const payableLineName = optionalTrimmedString(formData.payableLineName) ?? ""
  const invoiceDate = requiredTimestampFromForm(formData.invoiceDate)
  if (invoiceDate == null) return null

  const expenseLine = emptyMoveLineParams(defaultExpenseAccountId)
  expenseLine.excludeFromInvoiceTab = checkboxFromForm(
    formData.expenseExcludeFromInvoiceTab,
    false,
  )
  expenseLine.blocked = checkboxFromForm(formData.expenseBlocked, false)

  const payableLine = emptyMoveLineParams(payableAccountId)
  payableLine.name = payableLineName
  payableLine.partnerId = partnerId
  payableLine.excludeFromInvoiceTab = checkboxFromForm(
    formData.payableExcludeFromInvoiceTab,
    true,
  )
  payableLine.blocked = checkboxFromForm(formData.payableBlocked, false)

  return {
    journalId,
    defaultExpenseAccountId,
    invoiceDate,
    expenseLine,
    payableLine,
    metadata: optionalTrimmedString(formData.narration),
  }
}

export function toCreatePurchaseOrderParams(
  formData: Record<string, unknown>,
  pricelists: Array<{ id: unknown; currencyId?: unknown }>,
): CreatePurchaseOrderParams | null {
  const partnerId = nullableBigIntU64(formData.partnerId)
  const pricelistId = nullableBigIntU64(formData.pricelistId)
  if (partnerId == null || pricelistId == null) return null

  const pl = pricelists.find((p) => String(p.id) === String(pricelistId))
  if (pl == null || pl.currencyId == null || pl.currencyId === undefined) return null
  const currencyId = BigInt(Number(pl.currencyId))

  const datePlannedRaw = formData.datePlanned
  const hasDatePlanned = datePlannedRaw != null && String(datePlannedRaw).trim() !== ""
  let datePlanned: Timestamp | undefined
  if (hasDatePlanned) {
    const parsedDatePlanned = requiredTimestampFromForm(datePlannedRaw)
    if (parsedDatePlanned == null) return null
    datePlanned = parsedDatePlanned
  }

  return {
    companyId: undefined,
    partnerId,
    currencyId,
    origin: optionalTrimmedString(formData.origin),
    partnerRef: optionalTrimmedString(formData.partnerRef),
    notes: optionalTrimmedString(formData.notes),
    datePlanned,
    paymentTermId: optionalBigIntU64(formData.paymentTermId),
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
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreatePurchaseRequisitionParams(
  formData: Record<string, unknown>,
): CreatePurchaseRequisitionParams {
  const productId = nullableBigIntU64(formData.productId)
  const productUom = nullableBigIntU64(formData.uomId ?? formData.productUom)
  const productUomQty = Number(formData.quantity ?? formData.productUomQty)
  const lines =
    productId != null &&
    productUom != null &&
    Number.isFinite(productUomQty) &&
    productUomQty > 0
      ? [
          {
            productId,
            productUom,
            productUomQty,
            name: optionalTrimmedString(formData.lineName ?? formData.description),
            sequence: 10,
          },
        ]
      : []

  return {
    companyId: undefined,
    origin: optionalTrimmedString(formData.origin),
    description: optionalTrimmedString(formData.description),
    orderingDate: optionalTimestampFromForm(formData.orderingDate),
    dateEnd: optionalTimestampFromForm(formData.dateEnd),
    scheduleDate: optionalTimestampFromForm(formData.scheduleDate),
    departmentId: optionalBigIntU64(formData.departmentId),
    exclusive: undefined,
    multipleProduct: false,
    lineIds: [],
    lines,
    purchaseIds: [],
    vendorId: optionalBigIntU64(formData.vendorId),
    activityIds: [],
    messageFollowerIds: [],
    messageIds: [],
    metadata: undefined,
  }
}

export function toAddPurchaseOrderLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const orderId = formData.orderId
  const productId = formData.productId
  const uomId = formData.uomId
  const quantity = Number(formData.quantity)
  const priceUnit = Number(formData.priceUnit)
  if (
    orderId === "" ||
    orderId == null ||
    productId === "" ||
    productId == null ||
    uomId === "" ||
    uomId == null ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(priceUnit) ||
    priceUnit < 0
  ) {
    return null
  }
  return {
    productId: Number(productId),
    quantity,
    uomId: Number(uomId),
    priceUnit,
    lotId:
      formData.lotId == null || String(formData.lotId).trim() === ""
        ? undefined
        : Number(formData.lotId),
  }
}

export function toReceivePoLineArgs(formData: Record<string, unknown>): {
  lineId: number
  qty: number
  lotId?: number
} | null {
  const lineId = Number(formData.lineId)
  const qty = Number(formData.qty)
  if (!Number.isFinite(lineId) || lineId <= 0 || !Number.isFinite(qty) || qty <= 0) return null
  const lotRaw = formData.lotId
  const lotId =
    lotRaw == null || String(lotRaw).trim() === ""
      ? undefined
      : Number(lotRaw)
  if (lotId !== undefined && (!Number.isFinite(lotId) || lotId <= 0)) return null
  return lotId === undefined ? { lineId, qty } : { lineId, qty, lotId }
}

export function toInvoicePoLineArgs(formData: Record<string, unknown>): {
  lineId: number
  qty: number
} | null {
  const args = toReceivePoLineArgs(formData)
  if (!args) return null
  return { lineId: args.lineId, qty: args.qty }
}

/** Params for `update_purchase_order_line` (optional fields — only sent when set). */
export function toUpdatePurchaseOrderLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const lineId = formData.lineId
  if (lineId === "" || lineId == null) return null

  const quantity = Number(formData.quantity)
  const priceUnit = Number(formData.priceUnit)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  if (!Number.isFinite(priceUnit) || priceUnit < 0) return null

  const productId = formData.productId
  const uomId = formData.uomId
  const productIdValue = productId !== "" && productId != null ? Number(productId) : undefined
  const uomIdValue = uomId !== "" && uomId != null ? Number(uomId) : undefined

  const params: Record<string, unknown> = {
    quantity,
    priceUnit,
    productId: productIdValue,
    uomId: uomIdValue,
  }

  // Only send taxIds when the caller provided them — never force [] (wipes PO line tax).
  if (formData.taxIds != null) {
    const raw = formData.taxIds
    const taxIds = Array.isArray(raw)
      ? raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      : String(raw)
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n) && n > 0)
    params.taxIds = taxIds
  }

  return params
}

export function toCreateLandedCostParams(
  formData: Record<string, unknown>,
): CreateLandedCostParams | null {
  const pickingRaw = formData.pickingId
  const currencyId = nullableBigIntU64(formData.currencyId)
  const amountTotal = Number(formData.amountTotal)
  if (pickingRaw == null || pickingRaw === "" || currencyId == null) return null
  if (!Number.isFinite(amountTotal) || amountTotal < 0) return null
  const date = requiredTimestampFromForm(formData.date)
  if (date == null) return null

  return {
    date,
    targetMove: formData.targetMove ? String(formData.targetMove) : "receipt",
    currencyId,
    amountTotal,
    pickingIds: [BigInt(Number(pickingRaw))],
    costLines: [],
    valuationAdjustmentLines: [],
    accountMoveId: undefined,
    accountJournalId: undefined,
    vendorBillId: undefined,
    description: optionalTrimmedString(formData.description),
    activityIds: [],
    messageFollowerIds: [],
    messageIds: [],
    metadata: undefined,
  }
}

export function toUpdateLandedCostParams(
  formData: Record<string, unknown>,
): UpdateLandedCostParams | null {
  const params: Partial<UpdateLandedCostParams> = {}
  if (formData.targetMove != null && formData.targetMove !== "") {
    params.targetMove = String(formData.targetMove)
  }
  const currencyId = nullableBigIntU64(formData.currencyId)
  if (currencyId != null) params.currencyId = currencyId
  const amountTotal = Number(formData.amountTotal)
  if (Number.isFinite(amountTotal) && amountTotal >= 0) params.amountTotal = amountTotal
  if (formData.date != null && formData.date !== "") {
    const date = requiredTimestampFromForm(formData.date)
    if (date == null) return null
    params.date = date
  }
  const description = optionalTrimmedString(formData.description)
  if (description != null) params.description = description
  if (Object.keys(params).length === 0) return null
  return params as UpdateLandedCostParams
}

export function toAddLandedCostLineParams(
  formData: Record<string, unknown>,
): AddLandedCostLineParams | null {
  const productId = nullableBigIntU64(formData.productId)
  const currencyId = nullableBigIntU64(formData.currencyId)
  const priceUnit = Number(formData.priceUnit)
  const splitTag = String(formData.splitMethod ?? "Equal")
  if (productId == null || currencyId == null) return null
  if (!Number.isFinite(priceUnit) || priceUnit < 0) return null

  return {
    productId,
    priceUnit,
    currencyId,
    splitMethod: { tag: splitTag } as AddLandedCostLineParams["splitMethod"],
    metadata: undefined,
  }
}
