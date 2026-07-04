/**
 * Map modular form values → SpacetimeDB reducer bodies for purchasing `/api/call/*`.
 */

import type {
  AddAccountMoveLineParams,
  CreateBillFromPurchaseOrderParams,
  CreatePurchaseOrderParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredBigIntU64(v: unknown): bigint | null {
  if (v == null || v === "") return null
  if (typeof v === "bigint") return v
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return BigInt(Math.trunc(n))
  try {
    return BigInt(String(v).trim())
  } catch {
    return null
  }
}

function optionalBigIntU64(v: unknown): bigint | undefined {
  const n = requiredBigIntU64(v)
  return n == null ? undefined : n
}

function timestampFromFormDate(v: unknown, fallback: Date): Timestamp {
  if (v == null || String(v).trim() === "") return stbTimestampFromDate(fallback)
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return stbTimestampFromDate(fallback)
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
  const journalId = requiredBigIntU64(formData.journalId)
  const defaultExpenseAccountId = requiredBigIntU64(formData.defaultExpenseAccountId)
  const payableAccountId = requiredBigIntU64(formData.payableAccountId)
  if (journalId == null || defaultExpenseAccountId == null || payableAccountId == null) {
    return null
  }

  const partnerId = order?.partnerId
  const payableLineName = optionalTrimmedString(formData.payableLineName) ?? ""

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
    invoiceDate: timestampFromFormDate(formData.invoiceDate, new Date()),
    expenseLine,
    payableLine,
    metadata: optionalTrimmedString(formData.narration),
  }
}

export function toCreatePurchaseOrderParams(
  formData: Record<string, unknown>,
  pricelists: Array<{ id: unknown; currencyId?: unknown }>,
): CreatePurchaseOrderParams | null {
  const partnerId = requiredBigIntU64(formData.partnerId)
  const pricelistId = requiredBigIntU64(formData.pricelistId)
  if (partnerId == null || pricelistId == null) return null

  const pl = pricelists.find((p) => String(p.id) === String(pricelistId))
  if (pl == null || pl.currencyId == null || pl.currencyId === undefined) return null
  const currencyId = BigInt(Number(pl.currencyId))

  const datePlannedRaw = formData.datePlanned
  const datePlanned =
    datePlannedRaw != null && String(datePlannedRaw).trim() !== ""
      ? timestampFromFormDate(datePlannedRaw, new Date())
      : undefined

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
    metadata: undefined,
  }
}

/** Params for `add_purchase_order_line` (third argument). */
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
  }
}

export function toReceivePoLineArgs(formData: Record<string, unknown>): {
  lineId: number
  qty: number
} | null {
  const lineId = Number(formData.lineId)
  const qty = Number(formData.qty)
  if (!Number.isFinite(lineId) || lineId <= 0 || !Number.isFinite(qty) || qty <= 0) return null
  return { lineId, qty }
}

export function toInvoicePoLineArgs(formData: Record<string, unknown>): {
  lineId: number
  qty: number
} | null {
  return toReceivePoLineArgs(formData)
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

  return {
    quantity,
    priceUnit,
    taxIds: [] as number[],
    productId: productIdValue,
    uomId: uomIdValue,
  }
}
