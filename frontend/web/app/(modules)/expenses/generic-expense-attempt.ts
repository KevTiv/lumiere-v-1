
import { i18n } from "@lumiere/i18n"
import { mergeFieldDefaultValues } from "@lumiere/ui/lib/form-config-merge"
import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import type { CreateExpenseParams } from "@lumiere/stdb/types"
import type { ExpenseCaptureOutboxItem, ExpenseCapturePayload } from "../../../lib/expense-capture-outbox"

/** Serialize every admitted create parameter into the existing capture checkpoint. */
export function genericExpensePayload(params: Partial<CreateExpenseParams>, values: FormValues): ExpenseCapturePayload {
  if (!params.employeeId || !params.currencyId || !params.date || !params.lineKind || !params.paymentMode) throw new Error(i18n.t("expenses.genericExpenseAttempt.theExpenseContextIsIncomplete"))
  return {
    employeeId: String(params.employeeId), currencyId: String(params.currencyId),
    name: params.name ?? "", date: new Date(String(values.date)).toISOString(),
    unitAmount: params.unitAmount ?? 0, quantity: params.quantity ?? 1,
    description: params.description, hasReceipt: values.hasReceipt !== false && values.hasReceipt !== "false",
    lineKind: params.lineKind.tag, paymentMode: params.paymentMode.tag,
    merchantKey: params.merchantKey, productId: params.productId?.toString(),
    taxIds: params.taxIds?.map(String), accountId: params.accountId?.toString(),
    analyticAccountId: params.analyticAccountId?.toString(), projectId: params.projectId?.toString(),
    mileageDistance: params.mileageDistance, mileageRateId: params.mileageRateId?.toString(),
    perDiemDays: params.perDiemDays, perDiemRateId: params.perDiemRateId?.toString(),
    policyExceptionReason: params.policyExceptionReason,
  }
}

export function pendingGenericExpense(items: readonly ExpenseCaptureOutboxItem[], actorIdentity: string): ExpenseCaptureOutboxItem | null {
  const pending = items.filter((item) => item.formOrigin?.actorIdentity === actorIdentity && item.syncState !== "synced")
  if (pending.length > 1) throw new Error(i18n.t("expenses.genericExpenseAttempt.multipleRetainedExpenseRequestsNeedReviewNoNewRequestWasStarted"))
  return pending[0] ?? null
}

export function canReattachGenericReceipt(item: ExpenseCaptureOutboxItem): boolean {
  return Boolean(item.receipt && !item.receipt.uploaded && item.syncState !== "unknown" && item.syncState !== "submitting" && item.syncState !== "synced")
}

/** Preserve the existing renderer and form ID; only defaults and field availability change. */
export function retainedExpenseForm(config: FormConfig, item: ExpenseCaptureOutboxItem | null, allowReceiptReattachment = true): FormConfig {
  if (!item) return config
  const values: FormValues = { ...item.payload, date: item.payload.date.slice(0, 10), totalAmount: item.payload.unitAmount, pricelistId: item.formOrigin?.pricelistId }
  const restored = mergeFieldDefaultValues(config, values)
  return { ...restored, showReset: false, sections: restored.sections.map((section) => ({ ...section, fields: section.fields.map((field) => {
    const defaultValue = field.defaultValue
    const frozen = { ...field, disabled: field.name !== "receiptFile" || !allowReceiptReattachment || !canReattachGenericReceipt(item) }
    if (frozen.type !== "select" && frozen.type !== "multiselect") return frozen
    const selected = (Array.isArray(defaultValue) ? defaultValue : [defaultValue]).filter((value) => value != null && value !== "").map(String)
    const missing = selected.filter((value) => !frozen.options.some((option) => option.value === value))
    return { ...frozen, options: [...frozen.options, ...missing.map((value) => ({ value, label: value, disabled: true }))] }
  }) })) }
}
