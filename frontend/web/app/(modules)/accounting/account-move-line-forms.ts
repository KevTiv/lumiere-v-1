import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';
import type { AddAccountMoveLineParams } from '@lumiere/stdb/types';

/** Params of `add_account_move_line` from the add-line form; null when the move, account or label is missing. Shared by the list and the invoice page. */
export function toAddAccountMoveLineParamsFromForm(
  formData: Record<string, unknown>,
): { moveId: bigint; params: AddAccountMoveLineParams } | null {
  const moveId = optionalBigIntU64(formData.moveId)
  const accountId = optionalBigIntU64(formData.accountId)
  const name = String(formData.name ?? "").trim()
  if (!moveId || !accountId || !name) return null
  const debit = Number(formData.debit ?? 0)
  const credit = Number(formData.credit ?? 0)
  return {
    moveId,
    params: {
      accountId,
      name,
      debit: Number.isFinite(debit) ? debit : 0,
      credit: Number.isFinite(credit) ? credit : 0,
      sequence: 10,
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
    },
  }
}
