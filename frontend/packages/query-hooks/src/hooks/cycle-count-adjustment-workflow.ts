import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  CYCLE_COUNT_POST_AFFECTS,
  WorkflowError,
  captureCycleCountAdjustmentSnapshot,
  observeCycleCountAdjustment,
  type CycleCountAdjustmentSnapshot,
  type PostCycleCountAdjustmentsInput,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import { postCycleCountAdjustmentsCommand } from "./inventory/physical-inventory"
import { stockQuantsQueryOptions } from "./inventory/stock-operations"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type PostRunInput = PostCycleCountAdjustmentsInput & {
  snapshot: CycleCountAdjustmentSnapshot
}

export function useCycleCountAdjustmentWorkflow(
  organizationId: bigint,
  companyId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<PostRunInput>>(
    () => ({
      id: "inventory.cycle-count.post",
      command: (input) =>
        postCycleCountAdjustmentsCommand(companyId, input.cycleCountId),
      affects: CYCLE_COUNT_POST_AFFECTS,
      observe: async (input) =>
        observeCycleCountAdjustment(
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

  const post = useMemo(
    () =>
      async (
        input: PostCycleCountAdjustmentsInput,
        context?: { navigateToNext?: boolean },
      ) => {
        const rows = (await qc.fetchQuery({
          ...stockQuantsQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureCycleCountAdjustmentSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError(
            "validation",
            "Cycle count adjustment target quant is missing or ambiguous",
          )
        }

        const runInput: PostRunInput = { ...input, snapshot }
        return runner.run(
          `${spec.id}:${input.cycleCountId}`,
          spec,
          runInput,
          { navigateToNext: context?.navigateToNext },
        )
      },
    [organizationId, qc, runner, spec],
  )

  return {
    post,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
