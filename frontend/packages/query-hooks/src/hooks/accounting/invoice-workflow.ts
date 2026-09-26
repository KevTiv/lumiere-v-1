import { useMemo } from "react"
import {
  POST_INVOICE_AFFECTS,
  POST_PAYMENT_AFFECTS,
  RECONCILE_PAYMENT_AFFECTS,
  WorkflowError,
  postInvoiceAction,
  postPaymentAction,
  invoiceWorkflow,
  recordRef,
  type AnyWorkflowAction,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { fetchQueryList } from "../../http"
import { AmbiguousOperationEffectError } from "../operation-effect"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "../workflow"
import { postInvoiceCommand } from "./moves"
import {
  postAccountPaymentCommand,
  reconcilePaymentWithInvoiceCommand,
  registerPaymentOnInvoiceCommand,
} from "./payments"

export interface PostingAccounts {
  cogsAccountId: bigint
  inventoryAccountId: bigint
}

export interface InvoiceToPaymentLabels {
  postInvoice: string
  postPayment: string
}

export interface RegisterPaymentInput {
  paymentId: bigint
  invoiceIds: bigint[]
  isBill: boolean
}

export interface ReconcilePaymentInput {
  paymentMoveId: bigint
  invoiceMoveId: bigint
}

export interface ReconciliationMoveProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly paymentState?: unknown
  readonly payment_state?: unknown
  readonly amountResidual?: unknown
  readonly amount_residual?: unknown
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.toLowerCase()
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
  }
  return String(value).toLowerCase()
}

function finiteNonnegative(value: unknown): boolean {
  if (value == null || value === "") return false
  const number = Number(value)
  return Number.isFinite(number) && number >= 0
}

/** Resolve only the exact posted payment/invoice pair in one company. */
export function resolveReconciliationEffect(
  rows: readonly ReconciliationMoveProjection[],
  input: ReconcilePaymentInput,
) {
  const exactMove = (moveId: bigint) => {
    const matches = rows.filter((row) => parseStrictU64(row.id) === moveId)
    if (matches.length > 1) {
      throw new AmbiguousOperationEffectError(
        `Expected one account move ${moveId}, found ${matches.length}`,
      )
    }
    return matches[0] ?? null
  }
  const payment = exactMove(input.paymentMoveId)
  const invoice = exactMove(input.invoiceMoveId)
  if (!payment || !invoice) return null

  const paymentCompany = parseStrictU64(payment.companyId ?? payment.company_id)
  const invoiceCompany = parseStrictU64(invoice.companyId ?? invoice.company_id)
  const invoicePaymentState = stateTag(invoice.paymentState ?? invoice.payment_state)
  if (
    paymentCompany == null ||
    paymentCompany !== invoiceCompany ||
    stateTag(payment.state) !== "posted" ||
    stateTag(invoice.state) !== "posted" ||
    !["paid", "partial"].includes(invoicePaymentState) ||
    !finiteNonnegative(payment.amountResidual ?? payment.amount_residual) ||
    !finiteNonnegative(invoice.amountResidual ?? invoice.amount_residual)
  ) {
    return null
  }

  return {
    outcome: "applied" as const,
    next: recordRef(invoiceWorkflow.resource, input.invoiceMoveId, invoiceWorkflow.module),
  }
}

async function readReconciliationEffect(input: ReconcilePaymentInput) {
  const rows = await fetchQueryList(
    "/api/query/account-moves",
    "Failed to read reconciliation result",
  )
  return resolveReconciliationEffect(rows, input)
}

/**
 * Accounting side of order-to-cash (`accounting.invoice` / `accounting.payment`): post invoice,
 * post payment, apply a payment to invoices, reconcile. Actions bind generated commands and run
 * through the shared completion path.
 */
export function useInvoiceToPaymentWorkflow(
  organizationId: bigint,
  options: {
    labels: InvoiceToPaymentLabels
    /** Where posting an invoice books COGS/stock; undefined when the chart lacks them. */
    resolvePostingAccounts(): PostingAccounts | undefined
    /** Message shown when `resolvePostingAccounts` yields nothing. */
    missingAccountsMessage: string
  },
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const runner = useWorkflowRunner(organizationId, callbacks)
  const { labels, resolvePostingAccounts, missingAccountsMessage } = options

  const postInvoiceSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "accounting.invoice.post",
      command: (moveId) => {
        const accounts = resolvePostingAccounts()
        if (!accounts) throw new WorkflowError("validation", missingAccountsMessage)
        return postInvoiceCommand({ moveId, ...accounts })
      },
      affects: POST_INVOICE_AFFECTS,
      // Posting is where the customer is asked to pay: stay on the invoice.
      observe: async (moveId) => ({
        next: recordRef(invoiceWorkflow.resource, moveId, invoiceWorkflow.module),
      }),
    }),
    [resolvePostingAccounts, missingAccountsMessage],
  )

  const postPaymentSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "accounting.payment.post",
      command: (paymentId) => postAccountPaymentCommand(BigInt(paymentId)),
      affects: POST_PAYMENT_AFFECTS,
    }),
    [],
  )

  const registerPaymentSpec = useMemo<TransitionSpec<RegisterPaymentInput>>(
    () => ({
      id: "accounting.payment.register",
      command: registerPaymentOnInvoiceCommand,
      affects: RECONCILE_PAYMENT_AFFECTS,
    }),
    [],
  )

  const reconcilePaymentSpec = useMemo<TransitionSpec<ReconcilePaymentInput>>(
    () => ({
      id: "accounting.payment.reconcile",
      command: reconcilePaymentWithInvoiceCommand,
      affects: RECONCILE_PAYMENT_AFFECTS,
      observe: readReconciliationEffect,
    }),
    [],
  )

  const postInvoice = useMemo(
    () =>
      postInvoiceAction({
        label: labels.postInvoice,
        execute: (moveId, context) =>
          runner.run(`accounting.invoice.post:${moveId}`, postInvoiceSpec, moveId, {
            navigateToNext: context?.navigateToNext,
          }),
      }),
    [labels.postInvoice, runner, postInvoiceSpec],
  )

  const postPayment = useMemo(
    () =>
      postPaymentAction({
        label: labels.postPayment,
        execute: (paymentId) => runner.run(`accounting.payment.post:${paymentId}`, postPaymentSpec, paymentId),
      }),
    [labels.postPayment, runner, postPaymentSpec],
  )

  const invoiceActions = useMemo<Array<AnyWorkflowAction<RowValueMap>>>(() => [postInvoice], [postInvoice])
  const paymentActions = useMemo<Array<AnyWorkflowAction<RowValueMap>>>(() => [postPayment], [postPayment])

  return {
    postInvoice,
    invoiceActions,
    paymentActions,
    /** Form-backed: the surface collects the invoice ids, then dispatches. */
    registerPayment: (input: RegisterPaymentInput) =>
      runner.run(`accounting.payment.register:${input.paymentId}`, registerPaymentSpec, input),
    reconcilePayment: (input: ReconcilePaymentInput) =>
      runner.run(
        `accounting.payment.reconcile:${input.paymentMoveId}:${input.invoiceMoveId}`,
        reconcilePaymentSpec,
        input,
      ),
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
