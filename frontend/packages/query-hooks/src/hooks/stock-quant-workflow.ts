import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  STOCK_QUANT_MOVE_AFFECTS,
  WorkflowError,
  captureStockQuantMoveSnapshot,
  observeStockQuantMove,
  type MoveStockQuantInput,
  type RowValueMap,
  type StockQuantMoveSnapshot,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import {
  moveStockQuantCommand,
  stockQuantsQueryOptions,
} from "./inventory/stock-operations"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type MoveRunInput = MoveStockQuantInput & {
  snapshot: StockQuantMoveSnapshot
}

export function useStockQuantWorkflow(
  organizationId: bigint,
  companyId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<MoveRunInput>>(
    () => ({
      id: "inventory.stock-quant.move",
      command: (input) =>
        moveStockQuantCommand(companyId, {
          quantId: input.quantId,
          targetLocationId: input.targetLocationId,
          quantity: input.quantity,
        }),
      affects: STOCK_QUANT_MOVE_AFFECTS,
      observe: async (input) =>
        observeStockQuantMove(
          input,
          input.snapshot,
          (await qc.fetchQuery({
            ...stockQuantsQueryOptions(organizationId),
            staleTime: 0,
          })) as unknown as RowValueMap[],
        ),
    }),
    [companyId, organizationId, qc],
  )

  const move = useMemo(
    () =>
      async (
        input: MoveStockQuantInput,
        context?: { navigateToNext?: boolean },
      ) => {
        if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
          throw new WorkflowError(
            "validation",
            "Move quantity must be greater than zero",
          )
        }

        const rows = (await qc.fetchQuery({
          ...stockQuantsQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureStockQuantMoveSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError(
            "validation",
            "Stock move source/destination relation is missing or ambiguous",
          )
        }
        if (input.quantity > snapshot.sourceAvailableQuantity + 1e-9) {
          throw new WorkflowError(
            "validation",
            "Move quantity exceeds available stock",
          )
        }

        const runInput: MoveRunInput = { ...input, snapshot }
        return runner.run(
          `${spec.id}:${input.quantId}`,
          spec,
          runInput,
          { navigateToNext: context?.navigateToNext },
        )
      },
    [organizationId, qc, runner, spec],
  )

  return {
    move,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
