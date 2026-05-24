import type {
  CreateExpenseParams,
  CreateExpenseSheetParams,
} from "@lumiere/stdb/types"

import { optionalBigIntU64 } from "@/lib/form-coercion"
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

export function toCreateExpenseParams(
  formData: Record<string, unknown>,
  currencyId: unknown,
): Partial<CreateExpenseParams> | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const parsedCurrencyId = optionalBigIntU64(currencyIdFromLookup(currencyId))
  const date = requiredTimestamp(formData.date)
  if (employeeId === undefined || parsedCurrencyId === undefined || date === null) return null

  return {
    employeeId,
    name: String(formData.name ?? ""),
    date,
    unitAmount: Number(formData.totalAmount ?? 0),
    quantity: Number(formData.quantity ?? 1),
    currencyId: parsedCurrencyId,
    description: optionalString(formData.description),
    productId: undefined,
    taxIds: [],
    accountId: undefined,
    analyticAccountId: undefined,
    attachmentIds: [],
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
