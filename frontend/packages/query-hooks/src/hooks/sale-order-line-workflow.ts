import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { fetchQueryList, type QueryRow } from "../http"
import type { CreateSaleOrderLineParams } from "@lumiere/stdb/types"
import {
  SALE_ORDER_LINE_AFFECTS,
  WorkflowError,
  createSaleOrderLineAction,
  deleteSaleOrderLineAction,
  observeCreatedSaleOrderLine,
  observeDeletedSaleOrderLine,
  saleOrderLineIds,
  updateSaleOrderLineAction,
  type CreateSaleOrderLineInput,
  type RowValueMap,
  type TransitionSpec,
  type UpdateSaleOrderLineInput,
} from "@lumiere/erp-workflows"

import {
  createSaleOrderLineCommand,
  deleteSaleOrderLineCommand,
  saleOrdersQueryOptions,
  updateSaleOrderLineCommand,
} from "./sales"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "./workflow"

export interface SaleOrderLineWorkflowLabels {
  create: string
  update: string
  delete: string
}

type CreateInput = CreateSaleOrderLineInput<CreateSaleOrderLineParams>
type UpdateInput = UpdateSaleOrderLineInput<QueryRow>
type CreateRunInput = CreateInput & { lineIdsBefore: string[] }

/**
 * `sales.order-line` record workflow. Each transition also invalidates `sale-orders`: the
 * reducers recompute the parent order's totals, which the order list must pick up.
 */
export function useSaleOrderLineWorkflow(
  organizationId: bigint,
  companyId: bigint | undefined,
  labels: SaleOrderLineWorkflowLabels,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)
  const freshOrders = useMemo(
    () => async () =>
      (await qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 })) as unknown as RowValueMap[],
    [qc, organizationId],
  )

  const createSpec = useMemo<TransitionSpec<CreateRunInput>>(
    () => ({
      id: "sales.order-line.create",
      command: ({ orderId, params }) => createSaleOrderLineCommand({ orderId, params }),
      affects: SALE_ORDER_LINE_AFFECTS,
      observe: async ({ orderId, lineIdsBefore }) =>
        observeCreatedSaleOrderLine(orderId, lineIdsBefore, await freshOrders()),
    }),
    [freshOrders],
  )

  const updateSpec = useMemo<TransitionSpec<UpdateInput>>(
    () => ({
      id: "sales.order-line.update",
      command: (input) => {
        if (companyId == null || companyId === 0n) {
          return Promise.reject(new WorkflowError("validation", "companyId is required to update a sale order line"))
        }
        return updateSaleOrderLineCommand(companyId, input)
      },
      affects: SALE_ORDER_LINE_AFFECTS,
      noReadback: "Partial line edit re-priced by the reducer: no single state or relation effect to confirm.",
    }),
    [companyId],
  )

  const deleteSpec = useMemo<TransitionSpec<string>>(
    () => ({
      id: "sales.order-line.delete",
      command: deleteSaleOrderLineCommand,
      affects: SALE_ORDER_LINE_AFFECTS,
      observe: async (lineId) =>
        observeDeletedSaleOrderLine(
          lineId,
          await fetchQueryList("/api/query/sale-order-lines", "Failed to read sale order lines"),
        ),
    }),
    [],
  )

  const create = useMemo(
    () =>
      createSaleOrderLineAction<CreateSaleOrderLineParams>({
        label: labels.create,
        execute: async (input) => {
          const lineIdsBefore = saleOrderLineIds(input.orderId, await freshOrders())
          if (!lineIdsBefore) {
            throw new WorkflowError("validation", "Sale order is unavailable for line readback")
          }
          return runner.run(`sales.order-line.create:${input.orderId}`, createSpec, { ...input, lineIdsBefore })
        },
      }),
    [labels.create, runner, createSpec, freshOrders],
  )

  const update = useMemo(
    () =>
      updateSaleOrderLineAction<QueryRow>({
        label: labels.update,
        execute: (input) => runner.run(`sales.order-line.update:${input.lineId}`, updateSpec, input),
      }),
    [labels.update, runner, updateSpec],
  )

  const remove = useMemo(
    () =>
      deleteSaleOrderLineAction({
        label: labels.delete,
        execute: (lineId) => runner.run(`sales.order-line.delete:${lineId}`, deleteSpec, lineId),
      }),
    [labels.delete, runner, deleteSpec],
  )

  return { create, update, remove, isRunning: runner.isRunning, isPending: runner.isPending }
}
