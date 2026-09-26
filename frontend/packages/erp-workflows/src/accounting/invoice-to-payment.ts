/**
 * Accounts-receivable half of order-to-cash: posted invoice → payment → reconciliation.
 * AP bills reuse the same primitives (`isBill` on `register_payment_on_invoice`).
 *
 * Presentation gates only; the reducers remain the authority for state, period, permission and
 * three-way match.
 */

import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import type { WorkflowAction, WorkflowExecuteContext } from "../core/action"
import type { WorkflowResult } from "../core/result"
import { normalizedTag, rowId } from "../core/row"
import { defineWorkflow } from "../core/workflow"

export const invoiceWorkflow = defineWorkflow({
  id: "accounting.invoice",
  resource: "account_move",
  module: "accounting",
})

export const paymentWorkflow = defineWorkflow({
  id: "accounting.payment",
  resource: "account_payment",
  module: "accounting",
})

/** Posting also settles the linked sale order's invoice state, so Sales converges with it. */
export const POST_INVOICE_AFFECTS = ["account-moves", "account-move-lines", "sale-orders"] as const

export const POST_PAYMENT_AFFECTS = ["account-payments", "account-moves", "account-move-lines"] as const

/** Applying a payment moves residual/payment state on the invoice, so moves and payments both refresh. */
export const RECONCILE_PAYMENT_AFFECTS = [
  "account-payments",
  "account-moves",
  "account-move-lines",
  "sale-orders",
] as const

const INVOICE_LIKE = new Set(["outinvoice", "ininvoice", "outrefund", "inrefund"])

/** Customer/vendor invoice and refund documents (matches the `MoveType` variants). */
export function isInvoiceLikeMoveType(moveType: unknown): boolean {
  return INVOICE_LIKE.has(normalizedTag(moveType))
}

/** A draft invoice/refund; other draft entries post through `post_account_move`. */
export function isInvoicePostable(row: RowValueMap): boolean {
  return (
    isInvoiceLikeMoveType(firstNonNullKey(row, "moveType", "move_type")) &&
    normalizedTag(firstNonNullKey(row, "state")) === "draft"
  )
}

/** `PaymentState::NotPaid` is a payment that has not been posted yet. */
export function isPaymentPostable(row: RowValueMap): boolean {
  return normalizedTag(firstNonNullKey(row, "state")) === "notpaid"
}

/** Only a posted payment (`PaymentState::Paid`) can be applied to invoices. */
export function isPaymentRegistrable(row: RowValueMap): boolean {
  return normalizedTag(firstNonNullKey(row, "state")) === "paid"
}

export function postInvoiceAction(options: {
  label: string
  execute(moveId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, string> {
  return {
    id: "accounting.invoice.post",
    label: options.label,
    kind: "immediate",
    canPresent: isInvoicePostable,
    prepare: rowId,
    execute: options.execute,
  }
}

export function postPaymentAction(options: {
  label: string
  execute(paymentId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, string> {
  return {
    id: "accounting.payment.post",
    label: options.label,
    kind: "immediate",
    canPresent: isPaymentPostable,
    prepare: rowId,
    execute: options.execute,
  }
}
