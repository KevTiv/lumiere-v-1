import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  SERIAL_BLOCK_AFFECTS,
  WorkflowError,
  captureSerialBlockSnapshot,
  observeSerialBlock,
  type BlockSerialInput,
  type RowValueMap,
  type SerialBlockSnapshot,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import {
  blockSerialCommand,
  stockProductionSerialsQueryOptions,
} from "./inventory/traceability"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type BlockRunInput = BlockSerialInput & {
  snapshot: SerialBlockSnapshot
}

export function useSerialBlockWorkflow(
  organizationId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<BlockRunInput>>(
    () => ({
      id: "inventory.serial.block",
      command: (input) => blockSerialCommand(input.serialId, input.reason),
      affects: SERIAL_BLOCK_AFFECTS,
      observe: async (input) =>
        observeSerialBlock(
          input,
          input.snapshot,
          (await qc.fetchQuery({
            ...stockProductionSerialsQueryOptions(organizationId),
            staleTime: 0,
          })) as unknown as RowValueMap[],
        ),
    }),
    [organizationId, qc],
  )

  const block = useMemo(
    () =>
      async (
        input: BlockSerialInput,
        context?: { navigateToNext?: boolean },
      ) => {
        const rows = (await qc.fetchQuery({
          ...stockProductionSerialsQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureSerialBlockSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError("validation", "Serial not found")
        }

        const runInput: BlockRunInput = { ...input, snapshot }
        return runner.run(
          `${spec.id}:${input.serialId}`,
          spec,
          runInput,
          { navigateToNext: context?.navigateToNext },
        )
      },
    [organizationId, qc, runner, spec],
  )

  return {
    block,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
