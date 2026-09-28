import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  CANCEL_RETURN_AFFECTS,
  CONFIRM_RETURN_AFFECTS,
  CREATE_RETURN_ORDER_AFFECTS,
  CREDIT_NOTE_FROM_RETURN_AFFECTS,
  EXCHANGE_FROM_RETURN_AFFECTS,
  RECEIVE_RETURN_AFFECTS,
  WorkflowError,
  cancelReturnAction,
  confirmReturnAction,
  createReturnCreditNoteAction,
  createReturnOrderAction,
  exchangeReturnAction,
  observeConfirmedReturn,
  observeCreatedReturnOrder,
  observeExchangeOrder,
  observePickingState,
  observeReturnCreditNote,
  newCorrelationId,
  observeSameRecord,
  pickingStepsToDone,
  receiveReturnAction,
  recordRef,
  returnOrderWorkflow,
  returnExchangeOrderIds,
  rowId,
  stateIs,
  type AnyWorkflowAction,
  type CreateReturnCreditNoteInput,
  type CreateReturnOrderInput,
  type PickingStep,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"
import type { CreateCreditNoteFromReturnOrderParams, CreateReturnOrderParams } from "@lumiere/stdb/types"

import {
  assignStockPickingCommand,
  confirmStockPickingCommand,
  stockPickingsQueryOptions,
  validateStockPickingCommand,
} from "./inventory/stock-operations"
import {
  cancelReturnOrderCommand,
  confirmReturnOrderCommand,
  createCreditNoteFromReturnOrderCommand,
  createExchangeOrderFromReturnCommand,
  createReturnOrderCommand,
  returnOrdersQueryOptions,
  saleOrdersQueryOptions,
} from "./sales"
import { fetchQueryList } from "../http"
import { useWorkflowRunner, type WorkflowSurfaceCallbacks } from "./workflow"

export interface ReturnOrderWorkflowLabels {
  create: string
  confirm: string
  receive: string
  exchange: string
  cancel: string
  createCreditNote: string
  /** Shown when the return picking is cancelled or missing. */
  notReceivable: string
}

type CreditNoteInput = CreateReturnCreditNoteInput<CreateCreditNoteFromReturnOrderParams>
type CreateInput = CreateReturnOrderInput<CreateReturnOrderParams>
type CreateRunInput = CreateInput & { idempotencyKey: string }
type ExchangeRunInput = { returnOrderId: string; exchangeOrderIdsBefore: string[] }

/**
 * `sales.return` record workflow: RMA confirm → receive (return picking to done) → credit note,
 * plus exchange and cancel, run through the shared completion path.
 */
export function useReturnOrderWorkflow(
  organizationId: bigint,
  companyId: bigint,
  labels: ReturnOrderWorkflowLabels,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const specs = useMemo(() => {
    const fresh = <T,>(options: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; staleTime: number }) =>
      qc.fetchQuery({ ...options, staleTime: 0 }) as Promise<T>

    const stepCommands: Record<PickingStep, (pickingId: string) => Promise<void>> = {
      confirm: (id) => confirmStockPickingCommand(companyId, id),
      assign: (id) => assignStockPickingCommand(companyId, id),
      validate: (id) => validateStockPickingCommand(companyId, id),
    }

    // One key per submission, kept in the run input: a retry re-sends the same key and the server
    // converges on the return it already created, which the creation row names exactly.
    const create: TransitionSpec<CreateRunInput> = {
      id: "sales.return.create",
      idempotent: true,
      command: ({ params, idempotencyKey }) => createReturnOrderCommand(companyId, { ...params, idempotencyKey }),
      affects: CREATE_RETURN_ORDER_AFFECTS,
      observe: async ({ idempotencyKey }) => {
        const [creations, returns] = await Promise.all([
          fetchQueryList("/api/query/return-order-creations", "Failed to read return order creations"),
          fresh<RowValueMap[]>(returnOrdersQueryOptions(organizationId)),
        ])
        return observeCreatedReturnOrder(idempotencyKey, creations, returns)
      },
    }

    const confirm: TransitionSpec<string> = {
      id: "sales.return.confirm",
      command: (id) => confirmReturnOrderCommand(companyId, id),
      affects: CONFIRM_RETURN_AFFECTS,
      observe: async (id) =>
        observeConfirmedReturn(id, await fresh<RowValueMap[]>(returnOrdersQueryOptions(organizationId))),
    }

    // Input is the return picking id. Steps are planned from the picking's current state, so a
    // retry after a partial run (or a lost response) only replays what is still outstanding.
    const receive: TransitionSpec<string> = {
      id: "sales.return.receive",
      idempotent: true,
      command: async (pickingId) => {
        const pickings = await fresh<RowValueMap[]>(stockPickingsQueryOptions(organizationId))
        const row = pickings.find((picking) => rowId(picking) === pickingId)
        const steps = row ? pickingStepsToDone(row) : undefined
        if (!steps) throw new WorkflowError("validation", labels.notReceivable)
        for (const step of steps) await stepCommands[step](pickingId)
      },
      affects: RECEIVE_RETURN_AFFECTS,
      observe: async (pickingId) =>
        observePickingState(pickingId, "done", await fresh<RowValueMap[]>(stockPickingsQueryOptions(organizationId))),
    }

    const cancel: TransitionSpec<string> = {
      id: "sales.return.cancel",
      command: (id) => cancelReturnOrderCommand(companyId, id),
      affects: CANCEL_RETURN_AFFECTS,
      observe: async (id) =>
        observeSameRecord(
          recordRef(returnOrderWorkflow.resource, id, returnOrderWorkflow.module),
          await fresh<RowValueMap[]>(returnOrdersQueryOptions(organizationId)),
          stateIs("cancelled"),
        ),
    }

    const exchange: TransitionSpec<ExchangeRunInput> = {
      id: "sales.return.exchange",
      command: ({ returnOrderId }) => createExchangeOrderFromReturnCommand(companyId, returnOrderId),
      affects: EXCHANGE_FROM_RETURN_AFFECTS,
      observe: async ({ returnOrderId, exchangeOrderIdsBefore }) =>
        observeExchangeOrder(
          returnOrderId,
          exchangeOrderIdsBefore,
          await fresh<RowValueMap[]>(saleOrdersQueryOptions(organizationId)),
        ),
    }

    const creditNote: TransitionSpec<CreditNoteInput> = {
      id: "sales.return.create-credit-note",
      command: (input) => createCreditNoteFromReturnOrderCommand(companyId, input),
      affects: CREDIT_NOTE_FROM_RETURN_AFFECTS,
      observe: async ({ returnOrderId }) =>
        observeReturnCreditNote(returnOrderId, await fresh<RowValueMap[]>(returnOrdersQueryOptions(organizationId))),
    }

    return { create, confirm, receive, cancel, exchange, creditNote }
  }, [qc, organizationId, companyId, labels.notReceivable])

  const create = useMemo(
    () =>
      createReturnOrderAction<CreateReturnOrderParams>({
        label: labels.create,
        execute: (input, context) =>
          runner.run(
            `sales.return.create:${input.saleOrderId ?? "none"}`,
            specs.create,
            { ...input, idempotencyKey: newCorrelationId() },
            { navigateToNext: context?.navigateToNext },
          ),
      }),
    [labels.create, runner, specs],
  )

  const createCreditNote = useMemo(
    () =>
      createReturnCreditNoteAction<CreateCreditNoteFromReturnOrderParams>({
        label: labels.createCreditNote,
        execute: (input, context) =>
          runner.run(`sales.return.create-credit-note:${input.returnOrderId}`, specs.creditNote, input, {
            navigateToNext: context?.navigateToNext,
          }),
      }),
    [labels.createCreditNote, runner, specs],
  )

  const actions = useMemo<Array<AnyWorkflowAction<RowValueMap>>>(() => {
    const run = (id: string, spec: TransitionSpec<string>) => (input: string, context?: { navigateToNext?: boolean }) =>
      runner.run(`${id}:${input}`, spec, input, { navigateToNext: context?.navigateToNext })
    return [
      confirmReturnAction({ label: labels.confirm, execute: run("sales.return.confirm", specs.confirm) }),
      receiveReturnAction({ label: labels.receive, execute: run("sales.return.receive", specs.receive) }),
      exchangeReturnAction({
        label: labels.exchange,
        execute: async (returnOrderId, context) => {
          const exchangeOrderIdsBefore = returnExchangeOrderIds(
            returnOrderId,
            (await qc.fetchQuery({ ...saleOrdersQueryOptions(organizationId), staleTime: 0 })) as RowValueMap[],
          )
          return runner.run(
            `sales.return.exchange:${returnOrderId}`,
            specs.exchange,
            { returnOrderId, exchangeOrderIdsBefore },
            { navigateToNext: context?.navigateToNext },
          )
        },
      }),
      cancelReturnAction({ label: labels.cancel, execute: run("sales.return.cancel", specs.cancel) }),
      createCreditNote,
    ]
  }, [labels.confirm, labels.receive, labels.exchange, labels.cancel, runner, specs, createCreditNote, qc, organizationId])

  return { actions, create, createCreditNote, isRunning: runner.isRunning, isPending: runner.isPending }
}
