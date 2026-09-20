import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { CreateInvoiceFromSaleOrderParams } from "@lumiere/stdb/types"
import {
  CONFIRM_SALE_ORDER_AFFECTS,
  CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS,
  confirmSaleOrderAction,
  createInvoiceFromSaleOrderAction,
  observeConfirmedOrder,
  observeCreatedInvoice,
  type AnyWorkflowAction,
  type CreateInvoiceFromSaleOrderInput,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import { stockPickingsQueryOptions } from "./inventory/stock-operations"
import {
  confirmSaleOrderCommand,
  createInvoiceFromSaleOrderCommand,
  saleOrdersQueryOptions,
} from "./sales"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "./workflow"

export interface SaleOrderWorkflowLabels {
  confirm: string
  createInvoice: string
}

type InvoiceInput = CreateInvoiceFromSaleOrderInput<CreateInvoiceFromSaleOrderParams>

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

  const createInvoiceSpec = useMemo<TransitionSpec<InvoiceInput>>(
    () => ({
      id: "sales.order.create-invoice",
      command: createInvoiceFromSaleOrderCommand,
      affects: CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS,
      observe: async ({ orderId }) => {
        const orders = await qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 })
        return observeCreatedInvoice(orderId, orders as unknown as RowValueMap[])
      },
    }),
    [qc, organizationId],
  )

  const createInvoice = useMemo(
    () =>
      createInvoiceFromSaleOrderAction<CreateInvoiceFromSaleOrderParams>({
        label: labels.createInvoice,
        execute: (input, context) =>
          runner.run(`sales.order.create-invoice:${input.orderId}`, createInvoiceSpec, input, {
            navigateToNext: context?.navigateToNext,
          }),
      }),
    [labels.createInvoice, runner, createInvoiceSpec],
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
      createInvoice,
    ],
    [labels.confirm, runner, confirmSpec, createInvoice],
  )

  return { actions, createInvoice, isRunning: runner.isRunning, isPending: runner.isPending }
}
