import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  REPLENISHMENT_EXECUTE_AFFECTS,
  WorkflowError,
  captureReplenishmentExecutionSnapshot,
  observeReplenishmentExecution,
  type ExecuteReplenishmentRuleInput,
  type ReplenishmentExecutionSnapshot,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import { executeReplenishmentRuleCommand } from "./inventory/stock-operations"
import { purchaseOrdersQueryOptions } from "./purchasing"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type ExecuteRunInput = ExecuteReplenishmentRuleInput & {
  snapshot: ReplenishmentExecutionSnapshot
}

export function useReplenishmentExecutionWorkflow(
  organizationId: bigint,
  companyId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<ExecuteRunInput>>(
    () => ({
      id: "inventory.replenishment.execute",
      command: (input) =>
        executeReplenishmentRuleCommand(
          companyId,
          input.ruleId,
          input.idempotencyKey,
        ),
      affects: REPLENISHMENT_EXECUTE_AFFECTS,
      observe: async (input) =>
        observeReplenishmentExecution(
          input,
          input.snapshot,
          (await qc.fetchQuery({
            ...purchaseOrdersQueryOptions(organizationId),
            staleTime: 0,
          })) as unknown as RowValueMap[],
        ),
    }),
    [companyId, organizationId, qc],
  )

  const execute = useMemo(
    () =>
      async (
        input: ExecuteReplenishmentRuleInput,
        context?: { navigateToNext?: boolean },
      ) => {
        const rows = (await qc.fetchQuery({
          ...purchaseOrdersQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureReplenishmentExecutionSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError(
            "validation",
            "Replenishment demand target purchase order is ambiguous",
          )
        }

        const runInput: ExecuteRunInput = { ...input, snapshot }
        return runner.run(
          `${spec.id}:${input.ruleId}`,
          spec,
          runInput,
          { navigateToNext: context?.navigateToNext },
        )
      },
    [organizationId, qc, runner, spec],
  )

  return {
    execute,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
