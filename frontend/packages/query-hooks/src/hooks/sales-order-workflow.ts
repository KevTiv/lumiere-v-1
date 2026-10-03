import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { CreateInvoiceFromSaleOrderParams, UpdateSaleOrderParams } from "@lumiere/stdb/types"
import {
  ACCEPT_SALE_ORDER_QUOTATION_AFFECTS,
  CANCEL_SALE_ORDER_AFFECTS,
  COMPUTE_SALE_ORDER_TOTALS_AFFECTS,
  CONFIRM_SALE_ORDER_AFFECTS,
  CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS,
  SALE_ORDER_LOCK_AFFECTS,
  SEND_SALE_ORDER_QUOTATION_AFFECTS,
  UPDATE_SALE_ORDER_AFFECTS,
  WorkflowError,
  acceptSaleOrderQuotationAction,
  cancelSaleOrderAction,
  computeSaleOrderTotalsAction,
  confirmSaleOrderAction,
  lockSaleOrderAction,
  unlockSaleOrderAction,
  updateSaleOrderAction,
  createInvoiceFromSaleOrderAction,
  isQuotationSignedBy,
  isSaleOrderLocked,
  observeConfirmedOrder,
  observeCreatedInvoice,
  observeSameRecord,
  recordRef,
  saleOrderInvoiceIds,
  saleOrderWorkflow,
  sendSaleOrderQuotationAction,
  stateIs,
  type AcceptSaleOrderQuotationInput,
  type AnyWorkflowAction,
  type CreateInvoiceFromSaleOrderInput,
  type RowValueMap,
  type TransitionSpec,
  type ObservedTransition,
  type UpdateSaleOrderInput,
} from "@lumiere/erp-workflows"

import { stockPickingsQueryOptions } from "./inventory/stock-operations"
import {
  acceptSaleOrderQuotationCommand,
  cancelSaleOrderCommand,
  computeSaleOrderTotalsCommand,
  confirmSaleOrderCommand,
  createInvoiceFromSaleOrderCommand,
  lockSaleOrderCommand,
  saleOrdersQueryOptions,
  sendSaleOrderQuotationCommand,
  unlockSaleOrderCommand,
  updateSaleOrderCommand,
} from "./sales"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "./workflow"

export interface SaleOrderWorkflowLabels {
  confirm: string
  createInvoice: string
  sendQuotation: string
  acceptQuotation: string
  cancel: string
  recalculateTotals: string
  lock: string
  unlock: string
  edit: string
}

type UpdateInput = UpdateSaleOrderInput<Partial<UpdateSaleOrderParams>>
type InvoiceInput = CreateInvoiceFromSaleOrderInput<CreateInvoiceFromSaleOrderParams>
type InvoiceRunInput = InvoiceInput & { invoiceIdsBefore: string[] }

/**
 * `sales.order` record workflow: actions bound to generated commands and run through the shared
 * completion path. Migrate further Sales actions by adding a transition here.
 */
export function useSaleOrderWorkflow(
  organizationId: bigint,
  companyId: bigint | undefined,
  labels: SaleOrderWorkflowLabels,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  /** In-place transitions read the same order back and require the effect on it. */
  const observeOrder = useMemo(
    () =>
      async (orderId: string, confirmed: (row: RowValueMap) => boolean): Promise<ObservedTransition> =>
        observeSameRecord(
          recordRef(saleOrderWorkflow.resource, orderId, saleOrderWorkflow.module),
          (await qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 })) as unknown as RowValueMap[],
          confirmed,
        ),
    [qc, organizationId],
  )

  const confirmSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order.confirm",
      command: (orderId) => confirmSaleOrderCommand(companyId, orderId),
      affects: CONFIRM_SALE_ORDER_AFFECTS,
      observe: async (orderId) => {
        const [orders, pickings] = await Promise.all([
          qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 }),
          qc.fetchQuery({ ...stockPickingsQueryOptions(organizationId), staleTime: 0 }),
        ])
        return observeConfirmedOrder(
          orderId,
          orders as unknown as RowValueMap[],
          pickings as unknown as RowValueMap[],
        )
      },
    }),
    [qc, organizationId, companyId],
  )

  const createInvoiceSpec = useMemo<TransitionSpec<InvoiceRunInput>>(
    () => ({
      id: "sales.order.create-invoice",
      command: ({ orderId, params }) => createInvoiceFromSaleOrderCommand({ orderId, params }),
      affects: CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS,
      observe: async ({ orderId, invoiceIdsBefore }) => {
        const orders = await qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 })
        return observeCreatedInvoice(orderId, invoiceIdsBefore, orders as unknown as RowValueMap[])
      },
    }),
    [qc, organizationId],
  )

  const sendQuotationSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order.send-quotation",
      command: sendSaleOrderQuotationCommand,
      affects: SEND_SALE_ORDER_QUOTATION_AFFECTS,
      observe: (orderId) => observeOrder(orderId, stateIs("Sent")),
    }),
    [observeOrder],
  )

  // Acceptance keeps the order Sent; the signer recorded on it is the effect.
  const acceptQuotationSpec = useMemo<TransitionSpec<AcceptSaleOrderQuotationInput>>(
    () => ({
      id: "sales.order.accept-quotation",
      command: acceptSaleOrderQuotationCommand,
      affects: ACCEPT_SALE_ORDER_QUOTATION_AFFECTS,
      observe: ({ orderId, signedBy }) => observeOrder(orderId, isQuotationSignedBy(signedBy)),
    }),
    [observeOrder],
  )

  const cancelSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order.cancel",
      command: (orderId) => cancelSaleOrderCommand({ orderId }),
      affects: CANCEL_SALE_ORDER_AFFECTS,
      observe: (orderId) => observeOrder(orderId, stateIs("Cancelled")),
    }),
    [observeOrder],
  )

  const totalsSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order.compute-totals",
      command: computeSaleOrderTotalsCommand,
      affects: COMPUTE_SALE_ORDER_TOTALS_AFFECTS,
      noReadback: "Idempotent recompute from lines: an unchanged total is a valid result, so no effect is distinguishable.",
    }),
    [],
  )

  const lockSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order.lock",
      command: lockSaleOrderCommand,
      affects: SALE_ORDER_LOCK_AFFECTS,
      observe: (orderId) => observeOrder(orderId, isSaleOrderLocked),
    }),
    [observeOrder],
  )

  const unlockSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order.unlock",
      command: unlockSaleOrderCommand,
      affects: SALE_ORDER_LOCK_AFFECTS,
      observe: (orderId) => observeOrder(orderId, (row) => !isSaleOrderLocked(row)),
    }),
    [observeOrder],
  )

  const updateSpec = useMemo<TransitionSpec<UpdateInput>>(
    () => ({
      id: "sales.order.update",
      command: (input) => {
        if (companyId == null || companyId === 0n) {
          return Promise.reject(new WorkflowError("validation", "companyId is required to update a sale order"))
        }
        return updateSaleOrderCommand(companyId, input)
      },
      affects: UPDATE_SALE_ORDER_AFFECTS,
      noReadback:
        "Partial header edit that can re-price lines: no single state or relation effect; the reducer rejects invalid input.",
    }),
    [companyId],
  )

  const acceptQuotation = useMemo(
    () =>
      acceptSaleOrderQuotationAction({
        label: labels.acceptQuotation,
        execute: (input) => runner.run(`sales.order.accept-quotation:${input.orderId}`, acceptQuotationSpec, input),
      }),
    [labels.acceptQuotation, runner, acceptQuotationSpec],
  )

  const cancel = useMemo(
    () =>
      cancelSaleOrderAction({
        label: labels.cancel,
        execute: (orderId) => runner.run(`sales.order.cancel:${orderId}`, cancelSpec, orderId),
      }),
    [labels.cancel, runner, cancelSpec],
  )

  const totals = useMemo(
    () =>
      computeSaleOrderTotalsAction({
        label: labels.recalculateTotals,
        execute: (orderId) => runner.run(`sales.order.compute-totals:${orderId}`, totalsSpec, orderId),
      }),
    [labels.recalculateTotals, runner, totalsSpec],
  )

  const lock = useMemo(
    () =>
      lockSaleOrderAction({
        label: labels.lock,
        execute: (orderId) => runner.run(`sales.order.lock:${orderId}`, lockSpec, orderId),
      }),
    [labels.lock, runner, lockSpec],
  )

  const unlock = useMemo(
    () =>
      unlockSaleOrderAction({
        label: labels.unlock,
        execute: (orderId) => runner.run(`sales.order.unlock:${orderId}`, unlockSpec, orderId),
      }),
    [labels.unlock, runner, unlockSpec],
  )

  const update = useMemo(
    () =>
      updateSaleOrderAction<Partial<UpdateSaleOrderParams>>({
        label: labels.edit,
        execute: (input) => runner.run(`sales.order.update:${input.orderId}`, updateSpec, input),
      }),
    [labels.edit, runner, updateSpec],
  )

  const createInvoice = useMemo(
    () =>
      createInvoiceFromSaleOrderAction<CreateInvoiceFromSaleOrderParams>({
        label: labels.createInvoice,
        execute: async (input, context) => {
          const orders = await qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 })
          const invoiceIdsBefore = saleOrderInvoiceIds(input.orderId, orders as unknown as RowValueMap[])
          if (!invoiceIdsBefore) {
            throw new WorkflowError("validation", "Sale order is unavailable for invoice readback")
          }
          return runner.run(
            `sales.order.create-invoice:${input.orderId}`,
            createInvoiceSpec,
            { ...input, invoiceIdsBefore },
            { navigateToNext: context?.navigateToNext },
          )
        },
      }),
    [labels.createInvoice, runner, createInvoiceSpec, qc, organizationId],
  )

  const actions = useMemo<Array<AnyWorkflowAction<RowValueMap>>>(
    () => [
      confirmSaleOrderAction({
        label: labels.confirm,
        execute: (orderId, context) =>
          runner.run(`sales.order.confirm:${orderId}`, confirmSpec, orderId, {
            navigateToNext: context?.navigateToNext,
          }),
      }),
      sendSaleOrderQuotationAction({
        label: labels.sendQuotation,
        execute: (orderId) => runner.run(`sales.order.send-quotation:${orderId}`, sendQuotationSpec, orderId),
      }),
      createInvoice,
    ],
    [labels.confirm, labels.sendQuotation, runner, confirmSpec, sendQuotationSpec, createInvoice],
  )

  return {
    /** Table-dispatchable record actions (confirm, send quotation) plus form-backed create invoice. */
    actions,
    createInvoice,
    acceptQuotation,
    update,
    /** Housekeeping actions, placed individually by the surface. */
    totals,
    lock,
    unlock,
    /** Dispatched separately so the surface can place the destructive action apart from the rest. */
    cancel,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
