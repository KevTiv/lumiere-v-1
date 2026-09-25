import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  SERIAL_USE_AFFECTS,
  WorkflowError,
  captureSerialUseSnapshot,
  observeSerialUse,
  type RowValueMap,
  type SerialUseSnapshot,
  type TransitionSpec,
  type UseSerialInput,
} from "@lumiere/erp-workflows"

import {
  stockProductionSerialsQueryOptions,
  useSerialCommand,
} from "./inventory/traceability"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type UseRunInput = UseSerialInput & {
  snapshot: SerialUseSnapshot
}

export function useSerialUseWorkflow(
  organizationId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<UseRunInput>>(
    () => ({
      id: "inventory.serial.use",
      command: (input) => useSerialCommand(input.serialId),
      affects: SERIAL_USE_AFFECTS,
      observe: async (input) =>
        observeSerialUse(
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

  const markInUse = useMemo(
    () =>
      async (
        input: UseSerialInput,
        context?: { navigateToNext?: boolean },
      ) => {
        const rows = (await qc.fetchQuery({
          ...stockProductionSerialsQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureSerialUseSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError("validation", "Serial not found")
        }

        const runInput: UseRunInput = { ...input, snapshot }
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
    markInUse,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
