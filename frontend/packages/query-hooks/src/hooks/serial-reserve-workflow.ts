import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  SERIAL_RESERVE_AFFECTS,
  WorkflowError,
  captureSerialReserveSnapshot,
  observeSerialReserve,
  type ReserveSerialInput,
  type RowValueMap,
  type SerialReserveSnapshot,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import {
  reserveSerialCommand,
  stockProductionSerialsQueryOptions,
} from "./inventory/traceability"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type ReserveRunInput = ReserveSerialInput & {
  snapshot: SerialReserveSnapshot
}

export function useSerialReserveWorkflow(
  organizationId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<ReserveRunInput>>(
    () => ({
      id: "inventory.serial.reserve",
      command: (input) => reserveSerialCommand(input.serialId),
      affects: SERIAL_RESERVE_AFFECTS,
      observe: async (input) =>
        observeSerialReserve(
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

  const reserve = useMemo(
    () =>
      async (
        input: ReserveSerialInput,
        context?: { navigateToNext?: boolean },
      ) => {
        const rows = (await qc.fetchQuery({
          ...stockProductionSerialsQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureSerialReserveSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError("validation", "Serial not found")
        }

        const runInput: ReserveRunInput = { ...input, snapshot }
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
    reserve,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
