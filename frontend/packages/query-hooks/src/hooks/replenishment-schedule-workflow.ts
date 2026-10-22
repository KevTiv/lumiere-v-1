import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  REPLENISHMENT_SCHEDULE_AFFECTS,
  WorkflowError,
  captureReplenishmentScheduleSnapshot,
  observeReplenishmentSchedule,
  type ReplenishmentScheduleAction,
  type ReplenishmentScheduleInput,
  type ReplenishmentScheduleSnapshot,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import {
  cancelReplenishmentRunCommand,
  replenishmentRulesQueryOptions,
  scheduleReplenishmentRunCommand,
} from "./inventory/stock-operations"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type ScheduleRunInput = ReplenishmentScheduleInput & {
  snapshot: ReplenishmentScheduleSnapshot
}

export function useReplenishmentScheduleWorkflow(
  organizationId: bigint,
  companyId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const fetchRows = useMemo(
    () => async () =>
      (await qc.fetchQuery({
        ...replenishmentRulesQueryOptions(organizationId),
        staleTime: 0,
      })) as unknown as RowValueMap[],
    [organizationId, qc],
  )

  const scheduleSpec = useMemo<TransitionSpec<ScheduleRunInput>>(
    () => ({
      id: "inventory.replenishment.schedule",
      command: (input) =>
        scheduleReplenishmentRunCommand(companyId, input.ruleId),
      affects: REPLENISHMENT_SCHEDULE_AFFECTS,
      observe: async (input) =>
        observeReplenishmentSchedule(input, input.snapshot, await fetchRows()),
    }),
    [companyId, fetchRows],
  )

  const cancelSpec = useMemo<TransitionSpec<ScheduleRunInput>>(
    () => ({
      id: "inventory.replenishment.schedule-cancel",
      command: (input) =>
        cancelReplenishmentRunCommand(companyId, input.ruleId),
      affects: REPLENISHMENT_SCHEDULE_AFFECTS,
      observe: async (input) =>
        observeReplenishmentSchedule(input, input.snapshot, await fetchRows()),
    }),
    [companyId, fetchRows],
  )

  const run = useMemo(
    () =>
      async (
        action: ReplenishmentScheduleAction,
        ruleId: string,
        context?: { navigateToNext?: boolean },
      ) => {
        const input: ReplenishmentScheduleInput = { action, ruleId }
        const snapshot = captureReplenishmentScheduleSnapshot(
          input,
          await fetchRows(),
        )
        if (!snapshot) {
          throw new WorkflowError(
            "validation",
            action === "schedule"
              ? "Replenishment rule is already scheduled, missing, or scheduler state is unavailable"
              : "Replenishment rule is not scheduled, missing, or scheduler state is unavailable",
          )
        }

        const spec = action === "schedule" ? scheduleSpec : cancelSpec
        const runInput: ScheduleRunInput = { ...input, snapshot }
        return runner.run(
          `${spec.id}:${ruleId}`,
          spec,
          runInput,
          { navigateToNext: context?.navigateToNext },
        )
      },
    [cancelSpec, fetchRows, runner, scheduleSpec],
  )

  return {
    schedule: (ruleId: string, context?: { navigateToNext?: boolean }) =>
      run("schedule", ruleId, context),
    cancel: (ruleId: string, context?: { navigateToNext?: boolean }) =>
      run("cancel", ruleId, context),
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
