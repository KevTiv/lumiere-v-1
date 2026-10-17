import type {
  CreateExpenseParams,
  CreateExpenseSheetParams,
  ExpenseLineKind,
  ExpensePaymentMode,
} from "@lumiere/stdb/types"

import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredTimestamp(v: unknown): CreateExpenseParams["date"] | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : stbTimestampFromDate(d)
}

function optionalTimestamp(v: unknown): CreateExpenseSheetParams["accountingDate"] {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
}

function currencyIdFromLookup(v: unknown): unknown {
  if (typeof v === "object" && v !== null && "currencyId" in v) {
    return (v as { currencyId: unknown }).currencyId
  }
  return v
}

function parseLineKind(v: unknown): ExpenseLineKind {
  const tag = String(v ?? "Standard")
  if (tag === "Mileage") return { tag: "Mileage" } as ExpenseLineKind
  if (tag === "PerDiem") return { tag: "PerDiem" } as ExpenseLineKind
  return { tag: "Standard" } as ExpenseLineKind
}

function parsePaymentMode(v: unknown): ExpensePaymentMode {
  const tag = String(v ?? "OutOfPocket")
  if (tag === "CorporateCard" || tag === "corporate_card" || tag === "card") {
    return { tag: "CorporateCard" } as ExpensePaymentMode
  }
  return { tag: "OutOfPocket" } as ExpensePaymentMode
}

function parseU64IdList(raw: unknown): bigint[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw
      .map((x) => optionalBigIntU64(x))
      .filter((x): x is bigint => x !== undefined && x > 0n)
  }
  return String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => optionalBigIntU64(s))
    .filter((x): x is bigint => x !== undefined && x > 0n)
}

/** Parse attachment ids from form; never invent stub id `1`. */
export function parseAttachmentIds(formData: Record<string, unknown>): bigint[] {
  if (formData.attachmentIds != null) {
    return parseU64IdList(formData.attachmentIds)
  }
  if (formData.attachment_ids != null) {
    return parseU64IdList(formData.attachment_ids)
  }
  return []
}

export function newExpenseReceiptClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `rcpt-${crypto.randomUUID()}`
  }
  return `rcpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Stable command identity supplied to the reducer so a transport retry cannot duplicate a line. */
export function newExpenseClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `expense-${crypto.randomUUID()}`
  }
  return `expense-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function toCreateExpenseParams(
  formData: Record<string, unknown>,
  currencyId: unknown,
  attachmentIds: bigint[] = [],
): Partial<CreateExpenseParams> | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const parsedCurrencyId = optionalBigIntU64(currencyIdFromLookup(currencyId))
  const date = requiredTimestamp(formData.date)
  if (employeeId === undefined || parsedCurrencyId === undefined || date === null) return null

  const lineKind = parseLineKind(formData.lineKind)
  const quantityRaw = formData.quantity
  // React Hook Form represents an untouched optional number input as an empty
  // string. The create contract's default quantity is one, so preserve that
  // default instead of coercing the empty string to zero.
  const quantity =
    quantityRaw == null || String(quantityRaw).trim() === "" ? 1 : Number(quantityRaw)
  const mileageDistance =
    formData.mileageDistance != null && String(formData.mileageDistance).trim() !== ""
      ? Number(formData.mileageDistance)
      : undefined
  const perDiemDays =
    formData.perDiemDays != null && String(formData.perDiemDays).trim() !== ""
      ? Number(formData.perDiemDays)
      : undefined

  return {
    employeeId,
    name: String(formData.name ?? ""),
    date,
    unitAmount: Number(formData.totalAmount ?? formData.unitAmount ?? 0),
    quantity,
    currencyId: parsedCurrencyId,
    description: optionalString(formData.description),
    productId: optionalBigIntU64(formData.productId),
    taxIds: parseU64IdList(formData.taxIds),
    accountId: optionalBigIntU64(formData.accountId),
    analyticAccountId: optionalBigIntU64(formData.analyticAccountId),
    projectId: optionalBigIntU64(formData.projectId),
    lineKind,
    mileageDistance: Number.isFinite(mileageDistance) ? mileageDistance : undefined,
    mileageRateId: optionalBigIntU64(formData.mileageRateId),
    perDiemDays: Number.isFinite(perDiemDays) ? perDiemDays : undefined,
    perDiemRateId: optionalBigIntU64(formData.perDiemRateId),
    attachmentIds,
    clientRequestId: optionalString(formData.clientRequestId),
    paymentMode: parsePaymentMode(formData.paymentMode),
    merchantKey: optionalString(formData.merchantKey),
    policyExceptionReason: optionalString(formData.policyExceptionReason),
  }
}

export function toCreateExpenseSheetParams(
  formData: Record<string, unknown>,
  currencyId: unknown,
): Partial<CreateExpenseSheetParams> | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const parsedCurrencyId = optionalBigIntU64(currencyIdFromLookup(currencyId))
  if (employeeId === undefined || parsedCurrencyId === undefined) return null

  return {
    employeeId,
    name: String(formData.name ?? ""),
    currencyId: parsedCurrencyId,
    notes: optionalString(formData.notes),
    accountingDate: optionalTimestamp(formData.accountingDate),
  }
}
