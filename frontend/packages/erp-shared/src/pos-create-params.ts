/**
 * Maps POS module form payloads to SpacetimeDB Create*Params types.
 */

import type {
  CreatePosConfigParams,
  CreatePosOrderLineParams,
  CreatePosOrderParams,
  CreatePosPaymentParams,
  ModuleConfigInput,
} from "@lumiere/stdb/types"

import { formValue as field, optionalBigIntU64, u64IdArrayFromForm, unwrapSome } from "./form-coercion"
import { parseStrictU64 } from "./u64"

function requiredBigIntU64(v: unknown): bigint | null {
  const unwrapped = unwrapSome(v)
  const isNoneEnvelope =
    v != null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 1 &&
    Object.prototype.hasOwnProperty.call(v, "none")
  if (
    unwrapped == null ||
    (typeof unwrapped === "string" && unwrapped.trim() === "") ||
    isNoneEnvelope
  ) return null
  // A supplied but malformed required ID must not silently select a context
  // default.  Only genuinely absent values are eligible for that fallback.
  const b = parseStrictU64(v)
  if (b === undefined) throw new RangeError("invalid required u64")
  return b
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const DEFAULT_MODULE_CONFIG: ModuleConfigInput = {
  moduleAccount: true,
  moduleInvoice: false,
  modulePosHr: false,
  modulePosRestaurant: false,
  modulePosDiscount: false,
  modulePosLoyalty: false,
  modulePosMercury: false,
  modulePosReprint: false,
  modulePosRestaurantAppointment: false,
  modulePosRestaurantPreparationDisplay: false,
  modulePosStripe: false,
  modulePosSix: false,
  modulePosAdyen: false,
  modulePosPaytm: false,
  modulePosVantiv: false,
  modulePosIngenico: false,
  isPosbox: false,
  ifaceTaxIncluded: false,
  taxRegimeSelection: false,
  taxRegime: false,
  cashControl: false,
  autoValidateTerminalPayment: false,
}

export type PosConfigMapperContext = {
  pickingTypeId: bigint
  journalId: bigint
  currencyId: bigint
  pricelistId: bigint
  warehouseId: bigint
  stockLocationId: bigint
}

export function toCreatePosConfigParams(
  formData: Record<string, unknown>,
  context: PosConfigMapperContext,
): CreatePosConfigParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  if (!name) return null
  return {
    name,
    pickingTypeId: requiredBigIntU64(field(formData, "pickingTypeId", "picking_type_id")) ?? context.pickingTypeId,
    journalId: requiredBigIntU64(field(formData, "journalId", "journal_id")) ?? context.journalId,
    currencyId: requiredBigIntU64(field(formData, "currencyId", "currency_id")) ?? context.currencyId,
    pricelistId: requiredBigIntU64(field(formData, "pricelistId", "pricelist_id")) ?? context.pricelistId,
    warehouseId: requiredBigIntU64(field(formData, "warehouseId", "warehouse_id")) ?? context.warehouseId,
    stockLocationId: requiredBigIntU64(field(formData, "stockLocationId", "stock_location_id")) ?? context.stockLocationId,
    invoiceJournalId: optionalBigIntU64(field(formData, "invoiceJournalId", "invoice_journal_id")),
    tipProductId: optionalBigIntU64(field(formData, "tipProductId", "tip_product_id")),
    ifaceStartCategId: optionalBigIntU64(field(formData, "ifaceStartCategId", "iface_start_categ_id")),
    ifaceAvailableCategIds: u64IdArrayFromForm(field(formData, "ifaceAvailableCategIds", "iface_available_categ_ids")),
    fposId: optionalBigIntU64(field(formData, "fposId", "fpos_id")),
    teamId: optionalBigIntU64(field(formData, "teamId", "team_id")),
    crmTeamId: optionalBigIntU64(field(formData, "crmTeamId", "crm_team_id")),
    routeId: optionalBigIntU64(field(formData, "routeId", "route_id")),
    partnerId: optionalBigIntU64(field(formData, "partnerId", "partner_id")),
    analyticAccountId: optionalBigIntU64(field(formData, "analyticAccountId", "analytic_account_id")),
    paymentMethodIds: u64IdArrayFromForm(field(formData, "paymentMethodIds", "payment_method_ids")),
    trustedConfigIds: u64IdArrayFromForm(field(formData, "trustedConfigIds", "trusted_config_ids")),
    receiptHeader: (() => {
      const v = field(formData, "receiptHeader", "receipt_header")
      return v == null ? undefined : String(v)
    })(),
    receiptFooter: (() => {
      const v = field(formData, "receiptFooter", "receipt_footer")
      return v == null ? undefined : String(v)
    })(),
    proxyIp: (() => {
      const v = field(formData, "proxyIp", "proxy_ip")
      return v == null ? undefined : String(v)
    })(),
    availablePricelistIds: u64IdArrayFromForm(field(formData, "availablePricelistIds", "available_pricelist_ids")),
    moduleConfig: DEFAULT_MODULE_CONFIG,
  }
}

export function toCreatePosOrderLineParams(
  line: Record<string, unknown>,
  defaults?: { uomId?: bigint },
): CreatePosOrderLineParams | null {
  const productId = requiredBigIntU64(line.productId ?? line.product_id)
  if (productId === null) return null
  const uomId = requiredBigIntU64(line.uomId ?? line.uom_id) ?? defaults?.uomId
  if (uomId === null || uomId === undefined) return null
  const qty = num(line.qty ?? line.quantity, 0)
  const priceUnit = num(line.priceUnit ?? line.unit_price ?? line.price, 0)
  const discount = num(line.discount ?? line.discount_pct, 0)
  return {
    productId,
    qty: qty > 0 ? qty : 1,
    uomId,
    priceUnit,
    discount,
    taxIds: u64IdArrayFromForm(line.taxIds ?? line.tax_ids),
    taxAmount: num(line.taxAmount ?? line.tax_amount, 0),
    priceExtra: num(line.priceExtra ?? line.price_extra, 0),
    name: (() => {
      const v = line.name
      return v == null ? undefined : String(v)
    })(),
    fullProductName: (() => {
      const v = line.fullProductName ?? line.full_product_name
      return v == null ? undefined : String(v)
    })(),
    customerNote: (() => {
      const v = line.customerNote ?? line.customer_note
      return v == null ? undefined : String(v)
    })(),
    attributeValueIds: u64IdArrayFromForm(line.attributeValueIds ?? line.attribute_value_ids),
    isRewardLine: line.isRewardLine === true || line.is_reward_line === true,
    rewardId: optionalBigIntU64(line.rewardId ?? line.reward_id),
    couponId: optionalBigIntU64(line.couponId ?? line.coupon_id),
    refundedOrderlineId: optionalBigIntU64(line.refundedOrderlineId ?? line.refunded_orderline_id),
    loyaltyPoints: (() => {
      const v = line.loyaltyPoints ?? line.loyalty_points
      return v == null || v === "" ? undefined : num(v)
    })(),
  }
}

export function toCreatePosPaymentParams(
  payment: Record<string, unknown>,
): CreatePosPaymentParams | null {
  const paymentMethodId = requiredBigIntU64(payment.paymentMethodId ?? payment.payment_method_id)
  if (paymentMethodId === null) return null
  return {
    paymentMethodId,
    amount: num(payment.amount, 0),
    transactionId: (() => {
      const v = payment.transactionId ?? payment.transaction_id
      return v == null ? undefined : String(v)
    })(),
    cardType: (() => {
      const v = payment.cardType ?? payment.card_type
      return v == null ? undefined : String(v)
    })(),
    cardholderName: (() => {
      const v = payment.cardholderName ?? payment.cardholder_name
      return v == null ? undefined : String(v)
    })(),
    cardNumber: (() => {
      const v = payment.cardNumber ?? payment.card_number
      return v == null ? undefined : String(v)
    })(),
    isChange: payment.isChange === true || payment.is_change === true,
    isTip: payment.isTip === true || payment.is_tip === true,
  }
}

export function toCreatePosOrderParams(
  formData: Record<string, unknown>,
  defaults?: { uomId?: bigint },
): CreatePosOrderParams | null {
  const sessionId = requiredBigIntU64(field(formData, "sessionId", "session_id"))
  if (sessionId === null) return null
  const linesRaw = field(formData, "lines", "lines")
  const lines: CreatePosOrderLineParams[] = []
  if (Array.isArray(linesRaw)) {
    for (const line of linesRaw) {
      if (line && typeof line === "object") {
        const mapped = toCreatePosOrderLineParams(line as Record<string, unknown>, defaults)
        if (mapped) lines.push(mapped)
      }
    }
  }
  const paymentsRaw = field(formData, "payments", "payments")
  const payments: CreatePosPaymentParams[] = []
  if (Array.isArray(paymentsRaw)) {
    for (const payment of paymentsRaw) {
      if (payment && typeof payment === "object") {
        const mapped = toCreatePosPaymentParams(payment as Record<string, unknown>)
        if (mapped) payments.push(mapped)
      }
    }
  }
  return {
    sessionId,
    partnerId: optionalBigIntU64(field(formData, "partnerId", "partner_id")),
    lines,
    payments,
    toInvoice: field(formData, "toInvoice", "to_invoice") === true,
  }
}
