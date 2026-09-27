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
