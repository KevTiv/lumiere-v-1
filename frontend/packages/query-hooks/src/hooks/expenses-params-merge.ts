import type {
  CreateExpenseParams,
  CreateExpenseSheetParams,
  ExpenseLineKind,
  ExpensePaymentMode,
} from "@lumiere/stdb/types"

const UNIX_EPOCH_TIMESTAMP = { microsSinceUnixEpoch: 0n }

const STANDARD_LINE_KIND = { tag: "Standard" } as ExpenseLineKind
const OUT_OF_POCKET = { tag: "OutOfPocket" } as ExpensePaymentMode

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
    projectId: partial.projectId,
    lineKind: partial.lineKind ?? STANDARD_LINE_KIND,
    mileageDistance: partial.mileageDistance,
    mileageRateId: partial.mileageRateId,
    perDiemDays: partial.perDiemDays,
    perDiemRateId: partial.perDiemRateId,
    attachmentIds: partial.attachmentIds ?? [],
    clientRequestId: partial.clientRequestId,
    paymentMode: partial.paymentMode ?? OUT_OF_POCKET,
    merchantKey: partial.merchantKey,
    policyExceptionReason: partial.policyExceptionReason,
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
