/**
 * Maps Sales logistics / POS master forms to SpacetimeDB reducer params.
 */

import type {
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreateShippingMethodParams,
} from '@lumiere/stdb'
import { Timestamp } from 'spacetimedb'

import { stdbParamsToJson } from '@/lib/stdb-params-json'

function numU64(v: unknown): bigint | null {
  if (v == null || v === '') return null
  const n = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)))
  if (n < 0n) return null
  return n
}

function numF64(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseU64List(raw: unknown): bigint[] {
  if (raw == null || raw === '') return []
  const s = String(raw).trim()
  if (!s) return []
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => BigInt(x))
}

function paymentMethodTypeFromForm(raw: unknown): CreatePaymentMethodParams['paymentMethodType'] {
  const t = String(raw ?? 'Cash')
  if (t === 'Bank') return { tag: 'Bank' }
  if (t === 'Card') return { tag: 'Card' }
  if (t === 'DigitalWallet') return { tag: 'DigitalWallet' }
  if (t === 'LoyaltyPoints') return { tag: 'LoyaltyPoints' }
  return { tag: 'Cash' }
}

export function toCreateDeliveryCarrierParams(
  formData: Record<string, unknown>,
): CreateDeliveryCarrierParams | null {
  const productId = numU64(formData.productId)
  const currencyId = numU64(formData.currencyId)
  if (productId == null || currencyId == null) return null
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  return {
    name,
    productId,
    deliveryType: String(formData.deliveryType ?? 'fixed'),
    integrationLevel: String(formData.integrationLevel ?? 'rate'),
    invoicePolicy: String(formData.invoicePolicy ?? 'estimated'),
    countryIds: parseU64List(formData.countryIds),
    stateIds: parseU64List(formData.stateIds),
    zipPrefixIds: String(formData.zipPrefixIds ?? '')
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
    margin: numF64(formData.margin, 0),
    freeOver: Boolean(formData.freeOver),
    amount: numF64(formData.amount, 0),
    canGenerateReturn: Boolean(formData.canGenerateReturn),
    returnLabelOnDelivery: Boolean(formData.returnLabelOnDelivery),
    getReturnLabelFromPortal: Boolean(formData.getReturnLabelFromPortal),
    fixedCharge: numF64(formData.fixedCharge, 0),
    fixedWeight: numF64(formData.fixedWeight, 0),
    priceRuleIds: parseU64List(formData.priceRuleIds),
    shippingInsurance: numF64(formData.shippingInsurance, 0),
    shippingInsuranceIsPercentage: Boolean(formData.shippingInsuranceIsPercentage),
    useDetailedDeliveryDescription: Boolean(formData.useDetailedDeliveryDescription),
    currencyId,
    metadata:
      formData.metadata != null && String(formData.metadata).trim() !== ''
        ? String(formData.metadata)
        : undefined,
  }
}

export function toCreateDeliveryPriceRuleParams(
  formData: Record<string, unknown>,
): CreateDeliveryPriceRuleParams | null {
  const variable = String(formData.variable ?? '').trim()
  const operator = String(formData.operator ?? '<=').trim()
  if (!variable || !operator) return null

  return {
    variable,
    operator,
    maxValue: numF64(formData.maxValue, 0),
    listBasePrice: numF64(formData.listBasePrice, 0),
    listPrice: numF64(formData.listPrice, 0),
    standardPrice: numF64(formData.standardPrice, 0),
    metadata:
      formData.metadata != null && String(formData.metadata).trim() !== ''
        ? String(formData.metadata)
        : undefined,
  }
}

export function toCreateShippingMethodParams(
  formData: Record<string, unknown>,
): CreateShippingMethodParams | null {
  const productId = numU64(formData.productId)
  if (productId == null) return null
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  return {
    name,
    provider: String(formData.provider ?? 'manual'),
    productId,
    deliveryType: String(formData.deliveryType ?? 'fixed'),
    integrationLevel: String(formData.integrationLevel ?? 'rate'),
    invoicePolicy: String(formData.invoicePolicy ?? 'estimated'),
    fixedPrice: numF64(formData.fixedPrice, 0),
    margin: numF64(formData.margin, 0),
    freeOver: Boolean(formData.freeOver),
    amount: numF64(formData.amount, 0),
    metadata:
      formData.metadata != null && String(formData.metadata).trim() !== ''
        ? String(formData.metadata)
        : undefined,
  }
}

export function toCreatePaymentMethodParams(
  formData: Record<string, unknown>,
): CreatePaymentMethodParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const seqRaw = formData.sequence
  const sequence =
    seqRaw != null && seqRaw !== '' ? Math.max(0, Math.trunc(Number(seqRaw))) : 10

  return {
    name,
    paymentMethodType: paymentMethodTypeFromForm(formData.paymentMethodType),
    isCashCount: Boolean(formData.isCashCount),
    isCardPayment: Boolean(formData.isCardPayment),
    receivableAccountId: numU64(formData.receivableAccountId) ?? undefined,
    outstandingAccountId: numU64(formData.outstandingAccountId) ?? undefined,
    journalId: numU64(formData.journalId) ?? undefined,
    cashJournalId: numU64(formData.cashJournalId) ?? undefined,
    usePaymentTerminal:
      formData.usePaymentTerminal != null && String(formData.usePaymentTerminal).trim() !== ''
        ? String(formData.usePaymentTerminal)
        : undefined,
    splitTransactions: Boolean(formData.splitTransactions),
    openCashbox: Boolean(formData.openCashbox),
    image:
      formData.image != null && String(formData.image).trim() !== ''
        ? String(formData.image)
        : undefined,
    sequence: sequence >>> 0,
  }
}

export function toCreateLoyaltyProgramParams(
  formData: Record<string, unknown>,
): CreateLoyaltyProgramParams | null {
  const name = String(formData.name ?? '').trim()
  const currencyId = numU64(formData.currencyId)
  if (!name || currencyId == null) return null

  const dateToRaw = formData.dateTo
  let dateTo: Timestamp | undefined
  if (dateToRaw != null && String(dateToRaw).trim() !== '') {
    const d = new Date(String(dateToRaw))
    if (!Number.isNaN(d.getTime())) dateTo = Timestamp.fromDate(d)
  }

  const vdRaw = formData.validityDuration
  const validityDuration =
    vdRaw != null && vdRaw !== '' ? Math.max(0, Math.trunc(Number(vdRaw))) : undefined

  const vdtRaw = formData.validityDurationType
  const validityDurationType =
    vdtRaw != null && String(vdtRaw).trim() !== '' ? String(vdtRaw) : undefined

  const limitRaw = formData.limitUsage
  const limitUsage =
    limitRaw != null && limitRaw !== '' ? Math.max(0, Math.trunc(Number(limitRaw))) >>> 0 : 0

  return {
    name,
    currencyId,
    programType: String(formData.programType ?? 'promotion'),
    isNominative: Boolean(formData.isNominative),
    triggerProductIds: parseU64List(formData.triggerProductIds),
    validityDuration: validityDuration !== undefined ? (validityDuration >>> 0) : undefined,
    validityDurationType,
    dateTo,
    limitUsage,
  }
}

export function logisticsParamsToJson(params: object): Record<string, unknown> {
  return stdbParamsToJson(params)
}
