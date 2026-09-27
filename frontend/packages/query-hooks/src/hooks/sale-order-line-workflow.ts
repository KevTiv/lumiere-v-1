import { useMemo } from "react"
import type { QueryRow } from "../http"
import type { CreateSaleOrderLineParams } from "@lumiere/stdb/types"
import {
  SALE_ORDER_LINE_AFFECTS,
  WorkflowError,
  createSaleOrderLineAction,
  deleteSaleOrderLineAction,
  updateSaleOrderLineAction,
  type CreateSaleOrderLineInput,
  type TransitionSpec,
  type UpdateSaleOrderLineInput,
} from "@lumiere/erp-workflows"

import {
  createSaleOrderLineCommand,
  deleteSaleOrderLineCommand,
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
  const runner = useWorkflowRunner(organizationId, callbacks)

  const createSpec = useMemo<TransitionSpec<CreateInput>>(
    () => ({ id: "sales.order-line.create", command: createSaleOrderLineCommand, affects: SALE_ORDER_LINE_AFFECTS }),
    [],
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
    }),
    [companyId],
  )

  const deleteSpec = useMemo<TransitionSpec<string>>(
    () => ({ id: "sales.order-line.delete", command: deleteSaleOrderLineCommand, affects: SALE_ORDER_LINE_AFFECTS }),
    [],
  )

  const create = useMemo(
    () =>
      createSaleOrderLineAction<CreateSaleOrderLineParams>({
        label: labels.create,
        execute: (input) => runner.run(`sales.order-line.create:${input.orderId}`, createSpec, input),
      }),
    [labels.create, runner, createSpec],
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
