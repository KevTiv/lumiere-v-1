/**
 * Maps Sales module form payloads to SpacetimeDB reducer param types.
 */

import type {
  AddAccountMoveLineParams,
  CreateCreditNoteFromReturnOrderParams,
  CreateInvoiceFromSaleOrderParams,
  CreatePickingBatchParams,
  CreatePricelistItemParams,
  CreatePricelistParams,
  CreateReturnOrderLineParams,
  CreateReturnOrderParams,
  CreateSaleOrderLineParams,
  CreateSaleOrderParams,
} from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

import { stdbParamsToJson } from '@/lib/stdb-params-json'

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function optionalBigIntU64(v: unknown): bigint | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'bigint') return v
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return BigInt(Math.trunc(n))
  try {
    return BigInt(String(v).trim())
  } catch {
    return undefined
  }
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function optionalTimestampFromFormDate(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === '') return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

function discountPolicyFromForm(raw: unknown): CreatePricelistParams['discountPolicy'] {
  const s = String(raw ?? 'WithoutDiscount')
  if (s === 'WithDiscount') return { tag: 'WithDiscount' }
  return { tag: 'WithoutDiscount' }
}

export function toCreateSaleOrderParams(
  formData: Record<string, unknown>,
  pricelists: ReadonlyArray<Record<string, unknown>>,
  companyId: bigint,
): CreateSaleOrderParams | null {
  const partnerRaw = formData.partnerId
  const pricelistRaw = formData.pricelistId
  const warehouseRaw = formData.warehouseId
  if (partnerRaw === '' || partnerRaw == null) return null
  if (pricelistRaw === '' || pricelistRaw == null) return null
  if (warehouseRaw === '' || warehouseRaw == null) return null

  const partnerId = requiredBigIntU64(partnerRaw)
  const pricelistId = requiredBigIntU64(pricelistRaw)
  const warehouseId = requiredBigIntU64(warehouseRaw)
  if (partnerId == null || pricelistId == null || warehouseId == null) return null

  const pl = pricelists.find((p) => String(p.id) === String(pricelistRaw))
  const currencyRaw = pl?.currencyId
  if (currencyRaw === undefined || currencyRaw === null) return null
  const currencyId = requiredBigIntU64(currencyRaw)
  if (currencyId == null) return null

  const paymentTermId =
    formData.paymentTermId != null && formData.paymentTermId !== ''
      ? optionalBigIntU64(formData.paymentTermId)
      : undefined

  const commitmentDate = optionalTimestampFromFormDate(formData.commitmentDate)
  const clientOrderRef = optionalTrimmedString(formData.clientOrderRef)
  const note = optionalTrimmedString(formData.note)
  const validityRaw = formData.validityDate
  const metadataObj: Record<string, unknown> = {}
  if (validityRaw != null && String(validityRaw).trim() !== "") {
    metadataObj.validityDate = validityRaw
  }
  const commissionRateRaw = formData.commissionRatePercent
  if (commissionRateRaw != null && String(commissionRateRaw).trim() !== "") {
    const rate = Number(commissionRateRaw)
    if (Number.isFinite(rate) && rate > 0) {
      metadataObj.commission_rate_percent = rate
    }
  }
  const customMeta = optionalTrimmedString(formData.metadata)
  if (customMeta) {
    try {
      const parsed = JSON.parse(customMeta) as unknown
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(metadataObj, parsed as Record<string, unknown>)
      }
    } catch {
      // ignore invalid custom metadata JSON
    }
  }
  const metadata =
    Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : undefined

  const isDropship = checkboxFromForm(formData.isDropship, false)
  const invoicePolicyRaw = optionalTrimmedString(formData.invoicePolicy)
  const invoicePolicy =
    invoicePolicyRaw === "delivery" || invoicePolicyRaw === "order"
      ? invoicePolicyRaw
      : undefined

  return {
    companyId,
    partnerId,
    partnerInvoiceId: partnerId,
    partnerShippingId: partnerId,
    pricelistId,
    currencyId,
    warehouseId,
    clientOrderRef,
    paymentTermId,
    note,
    commitmentDate,
    isDropship,
    invoicePolicy,
    metadata,
    orderLines: [] as CreateSaleOrderParams['orderLines'],
  } as CreateSaleOrderParams
}

function checkboxFromForm(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false
  return fallback
}

function emptyMoveLineParams(accountId: bigint): AddAccountMoveLineParams {
  return {
    accountId,
    name: '',
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

export function toCreateInvoiceFromSaleOrderParams(
  formData: Record<string, unknown>,
  order?: { partnerInvoiceId?: bigint },
): CreateInvoiceFromSaleOrderParams | null {
  const journalId = requiredBigIntU64(formData.journalId)
  const defaultIncomeAccountId = requiredBigIntU64(formData.defaultIncomeAccountId)
  const receivableAccountId = requiredBigIntU64(formData.receivableAccountId)
  if (journalId == null || defaultIncomeAccountId == null || receivableAccountId == null) {
    return null
  }

  const partnerId = order?.partnerInvoiceId
  const receivableLineName = optionalTrimmedString(formData.receivableLineName) ?? ''

  const incomeLine = emptyMoveLineParams(defaultIncomeAccountId)
  incomeLine.excludeFromInvoiceTab = checkboxFromForm(
    formData.incomeExcludeFromInvoiceTab,
    false,
  )
  incomeLine.blocked = checkboxFromForm(formData.incomeBlocked, false)

  const receivableLine = emptyMoveLineParams(receivableAccountId)
  receivableLine.name = receivableLineName
  receivableLine.partnerId = partnerId
  receivableLine.excludeFromInvoiceTab = checkboxFromForm(
    formData.receivableExcludeFromInvoiceTab,
    true,
  )
  receivableLine.blocked = checkboxFromForm(formData.receivableBlocked, false)

  return {
    journalId,
    defaultIncomeAccountId,
    receivableLine,
    incomeLine,
    metadata: optionalTrimmedString(formData.narration),
  }
}

export function toCreatePricelistParams(
  formData: Record<string, unknown>,
): CreatePricelistParams | null {
  const cid = formData.currencyId
  if (cid === '' || cid == null) return null
  const currencyId = requiredBigIntU64(cid)
  if (currencyId == null) return null

  return {
    name: String(formData.name ?? ''),
    currencyId,
    discountPolicy: discountPolicyFromForm(formData.discountPolicy),
  }
}

export function toCreatePricelistItemParams(
  formData: Record<string, unknown>,
): CreatePricelistItemParams | null {
  const pricelistRaw = formData.pricelistId
  if (pricelistRaw == null || String(pricelistRaw).trim() === '') return null
  const pricelistId = BigInt(String(pricelistRaw))
  const appliedOnRaw = String(formData.appliedOn ?? 'AllProducts')
  const computeRaw = String(formData.computePrice ?? 'Fixed')
  const appliedOn =
    appliedOnRaw === 'Category'
      ? { tag: 'Category' as const }
      : appliedOnRaw === 'Product'
        ? { tag: 'Product' as const }
        : { tag: 'AllProducts' as const }
  const computePrice =
    computeRaw === 'Percentage'
      ? { tag: 'Percentage' as const }
      : computeRaw === 'Formula'
        ? { tag: 'Formula' as const }
        : { tag: 'Fixed' as const }
  const productRaw = formData.productId
  const categRaw = formData.categId
  return {
    pricelistId,
    appliedOn,
    computePrice,
    productTmplId: undefined,
    productId:
      productRaw == null || String(productRaw).trim() === ''
        ? undefined
        : BigInt(String(productRaw)),
    categId:
      categRaw == null || String(categRaw).trim() === ''
        ? undefined
        : BigInt(String(categRaw)),
    minQuantity: Number(formData.minQuantity ?? 1) || 0,
    dateStart: undefined,
    dateEnd: undefined,
    fixedPrice: Number(formData.fixedPrice ?? 0) || 0,
    percentPrice: Number(formData.percentPrice ?? 0) || 0,
    priceDiscount: Number(formData.priceDiscount ?? 0) || 0,
    priceSurcharge: 0,
    priceMinMargin: 0,
    priceMaxMargin: 0,
    sequence: Math.max(0, Math.trunc(Number(formData.sequence ?? 10))),
  }
}

export function salesParamsToJson(
  params: CreateSaleOrderParams | CreatePricelistParams,
): Record<string, unknown> {
  if ("partnerId" in params) {
    return stdbParamsToJson(params, "CreateSaleOrderParams")
  }
  return stdbParamsToJson(params)
}

function parseU64IdList(raw: unknown): bigint[] {
  if (raw == null || String(raw).trim() === '') return []
  return String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => BigInt(p))
}

export function toCreateSaleOrderLineParams(
  formData: Record<string, unknown>,
): CreateSaleOrderLineParams | null {
  const productId = requiredBigIntU64(formData.productId)
  const uomId = requiredBigIntU64(formData.uomId)
  const quantity = Number(formData.quantity)
  if (
    productId == null ||
    uomId == null ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null
  }

  const priceUnitRaw = formData.priceUnit
  let priceUnit: number | undefined
  if (priceUnitRaw !== '' && priceUnitRaw != null) {
    const n = Number(priceUnitRaw)
    if (!Number.isFinite(n) || n < 0) return null
    priceUnit = n
  }

  const discountRaw = formData.discount
  const discount =
    discountRaw === '' || discountRaw == null ? 0 : Number(discountRaw)
  if (!Number.isFinite(discount) || discount < 0) return null

  const sequenceRaw = formData.sequence
  const sequence =
    sequenceRaw === '' || sequenceRaw == null
      ? 10
      : Math.max(0, Math.trunc(Number(sequenceRaw)))

  return {
    productId,
    quantity,
    uomId,
    priceUnit,
    discount,
    taxIds: parseU64IdList(formData.taxIds),
    name: optionalTrimmedString(formData.name),
    sequence,
    isDownpayment: false,
    displayType: undefined,
    productVariantId: undefined,
    packagingId: undefined,
    routeId: undefined,
    analyticTagIds: [],
    customerLead: undefined,
    metadata: undefined,
  }
}

/** Default when the form does not include an explicit wave batch toggle. */
export const PICKING_BATCH_DEFAULT_IS_WAVE = false

function isWaveFromForm(raw: unknown): boolean {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true
  return PICKING_BATCH_DEFAULT_IS_WAVE
}

/** Comma- or whitespace-separated stock picking IDs -> `create_picking_batch` params. */
export function toCreatePickingBatchParams(
  formData: Record<string, unknown>,
): CreatePickingBatchParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null
  const raw = formData.pickingIds
  return {
    name,
    pickingIds:
      raw == null || String(raw).trim() === ''
        ? []
        : String(raw)
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((p) => BigInt(p)),
    isWave: isWaveFromForm(formData.isWave),
  } as CreatePickingBatchParams
}

export function toCreateReturnOrderLineParams(
  formData: Record<string, unknown>,
): CreateReturnOrderLineParams | null {
  const productId = requiredBigIntU64(formData.productId)
  const productUom = requiredBigIntU64(formData.uomId)
  const productUomQty = Number(formData.productUomQty ?? formData.quantity)
  const priceUnit = Number(formData.priceUnit)
  if (
    productId == null ||
    productUom == null ||
    !Number.isFinite(productUomQty) ||
    productUomQty <= 0 ||
    !Number.isFinite(priceUnit) ||
    priceUnit < 0
  ) {
    return null
  }

  const saleOrderLineRaw = formData.saleOrderLineId
  const saleOrderLineId =
    saleOrderLineRaw == null || String(saleOrderLineRaw).trim() === ''
      ? undefined
      : requiredBigIntU64(saleOrderLineRaw) ?? undefined

  return {
    saleOrderLineId,
    productId,
    productUom,
    productUomQty,
    priceUnit,
    toRefund: checkboxFromForm(formData.toRefund, true),
  }
}

export function toCreateReturnOrderParams(
  formData: Record<string, unknown>,
): CreateReturnOrderParams | null {
  const partnerId = requiredBigIntU64(formData.partnerId)
  if (partnerId == null) return null

  const line = toCreateReturnOrderLineParams(formData)
  if (line == null) return null

  const saleOrderRaw = formData.saleOrderId
  const saleOrderId =
    saleOrderRaw == null || String(saleOrderRaw).trim() === ''
      ? undefined
      : requiredBigIntU64(saleOrderRaw) ?? undefined

  return {
    partnerId,
    saleOrderId,
    returnReason: optionalTrimmedString(formData.returnReason),
    lines: [line],
  }
}

/** Same shape as invoice-from-sale-order params (journal + move lines). */
export function toCreateCreditNoteFromReturnOrderParams(
  formData: Record<string, unknown>,
): CreateCreditNoteFromReturnOrderParams | null {
  return toCreateInvoiceFromSaleOrderParams(formData)
}
