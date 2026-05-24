import type {
  CreateExpenseParams,
  CreateExpenseSheetParams,
} from "@lumiere/stdb/types"

const UNIX_EPOCH_TIMESTAMP = { microsSinceUnixEpoch: 0n }

/** Merge partial Expenses create payloads with hook defaults before `stdbParamsToJson`. */
export function finalizeCreateExpenseParams(
  partial: Partial<CreateExpenseParams>,
): CreateExpenseParams {
  return {
    companyId: partial.companyId,
    employeeId: partial.employeeId ?? 0n,
    name: partial.name ?? "",
    date: partial.date ?? (UNIX_EPOCH_TIMESTAMP as CreateExpenseParams["date"]),
    unitAmount: partial.unitAmount ?? 0,
    quantity: partial.quantity ?? 1,
    currencyId: partial.currencyId ?? 0n,
    productId: partial.productId,
    description: partial.description,
    taxIds: partial.taxIds ?? [],
    accountId: partial.accountId,
    analyticAccountId: partial.analyticAccountId,
    attachmentIds: partial.attachmentIds ?? [],
  }
}

export function finalizeCreateExpenseSheetParams(
  partial: Partial<CreateExpenseSheetParams>,
): CreateExpenseSheetParams {
  return {
    companyId: partial.companyId,
    employeeId: partial.employeeId ?? 0n,
    name: partial.name ?? "",
    currencyId: partial.currencyId ?? 0n,
    notes: partial.notes,
    accountingDate: partial.accountingDate,
  }
}
