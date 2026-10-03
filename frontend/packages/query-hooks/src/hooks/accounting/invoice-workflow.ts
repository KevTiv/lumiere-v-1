import { useMemo } from "react"
import {
  POST_INVOICE_AFFECTS,
  POST_PAYMENT_AFFECTS,
  RECONCILE_PAYMENT_AFFECTS,
  WorkflowError,
  invoiceWorkflow,
  observePostedInvoice,
  observeSameRecord,
  paymentWorkflow,
  postInvoiceAction,
  postPaymentAction,
  recordRef,
  stateIs,
  type AnyWorkflowAction,
  type ObservedTransition,
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

export interface PaymentRegistrationProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
}

export interface RegisteredInvoiceProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly moveType?: unknown
  readonly move_type?: unknown
  readonly state?: unknown
  readonly paymentState?: unknown
  readonly payment_state?: unknown
  readonly amountResidual?: unknown
  readonly amount_residual?: unknown
}

/** Payments read back from the canonical list, bypassing any cached view. */
async function observePayment(
  paymentId: bigint | string,
  confirmed: (row: RowValueMap) => boolean,
): Promise<ObservedTransition> {
  return observeSameRecord(
    recordRef(paymentWorkflow.resource, paymentId, paymentWorkflow.module),
    await fetchQueryList("/api/query/account-payments", "Failed to read payment"),
    confirmed,
  )
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
  if (typeof value === "string") return value.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
  }
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

function finiteNonnegative(value: unknown): boolean {
  if (value == null || value === "") return false
  const number = Number(value)
  return Number.isFinite(number) && number >= 0
}

/**
 * Confirm payment registration from fields available to the operator: the exact payment and every
 * exact invoice/bill must share a company, be posted, and expose a settled payment state/residual.
 * The payment's reconciled-id arrays are field-policy protected and are therefore not a usable
 * browser readback contract for ordinary accounting operators.
 */
export function resolveRegisteredPaymentEffect(
  payments: readonly PaymentRegistrationProjection[],
  moves: readonly RegisteredInvoiceProjection[],
  input: RegisterPaymentInput,
): ObservedTransition | null {
  if (input.invoiceIds.length === 0) return null

  const exactRow = <T extends { readonly id?: unknown }>(
    rows: readonly T[],
    id: bigint,
    resource: string,
  ): T | null => {
    const matches = rows.filter((row) => parseStrictU64(row.id) === id)
    if (matches.length > 1) {
      throw new AmbiguousOperationEffectError(
        `Expected one ${resource} ${id}, found ${matches.length}`,
      )
    }
    return matches[0] ?? null
  }

  const payment = exactRow(payments, input.paymentId, "account payment")
  const paymentCompany = parseStrictU64(payment?.companyId ?? payment?.company_id)
  if (!payment || paymentCompany == null || stateTag(payment.state) !== "paid") return null

  const expectedMoveTypes = input.isBill
    ? new Set(["ininvoice", "inrefund"])
    : new Set(["outinvoice", "outrefund"])

  for (const invoiceId of new Set(input.invoiceIds)) {
    const move = exactRow(moves, invoiceId, input.isBill ? "bill" : "invoice")
    if (!move) return null

    const company = parseStrictU64(move.companyId ?? move.company_id)
    const paymentState = stateTag(move.paymentState ?? move.payment_state)
    const residualValue = move.amountResidual ?? move.amount_residual
    const residual = Number(residualValue)
    if (
      company !== paymentCompany ||
      stateTag(move.state) !== "posted" ||
      !expectedMoveTypes.has(stateTag(move.moveType ?? move.move_type)) ||
      !["paid", "partial"].includes(paymentState) ||
      !finiteNonnegative(residualValue) ||
      (paymentState === "paid" && residual !== 0) ||
      (paymentState === "partial" && residual === 0)
    ) {
      return null
    }
  }

  return {
    outcome: "applied",
    next: recordRef(paymentWorkflow.resource, input.paymentId, paymentWorkflow.module),
  }
}

async function readRegisteredPaymentEffect(input: RegisterPaymentInput) {
  const [payments, moves] = await Promise.all([
    fetchQueryList("/api/query/account-payments", "Failed to read registered payment"),
    fetchQueryList("/api/query/account-moves", "Failed to read reconciled invoices"),
  ])
  return resolveRegisteredPaymentEffect(payments, moves, input) ?? {}
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
  return resolveReconciliationEffect(rows, input) ?? {}
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
      observe: async (moveId) =>
        observePostedInvoice(
          moveId,
          await fetchQueryList("/api/query/account-moves", "Failed to read posted invoice"),
        ),
    }),
    [resolvePostingAccounts, missingAccountsMessage],
  )

  const postPaymentSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "accounting.payment.post",
      command: (paymentId) => postAccountPaymentCommand(BigInt(paymentId)),
      affects: POST_PAYMENT_AFFECTS,
      observe: (paymentId) => observePayment(paymentId, stateIs("Paid")),
    }),
    [],
  )

  const registerPaymentSpec = useMemo<TransitionSpec<RegisterPaymentInput>>(
    () => ({
      id: "accounting.payment.register",
      command: registerPaymentOnInvoiceCommand,
      affects: RECONCILE_PAYMENT_AFFECTS,
      observe: readRegisteredPaymentEffect,
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
