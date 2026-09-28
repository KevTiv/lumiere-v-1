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

import {
  executeReplenishmentRuleCommand,
  stockPickingsQueryOptions,
} from "./inventory/stock-operations"
import { purchaseOrdersQueryOptions } from "./purchasing"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type ExecuteRunInput = ExecuteReplenishmentRuleInput & {
  snapshot: ReplenishmentExecutionSnapshot
}

async function fetchDemandRows(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
): Promise<[RowValueMap[], RowValueMap[]]> {
  const [purchaseOrders, stockPickings] = await Promise.all([
    qc.fetchQuery({
      ...purchaseOrdersQueryOptions(organizationId),
      staleTime: 0,
    }),
    qc.fetchQuery({
      ...stockPickingsQueryOptions(organizationId),
      staleTime: 0,
    }),
  ])
  return [
    purchaseOrders as unknown as RowValueMap[],
    stockPickings as unknown as RowValueMap[],
  ]
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
      observe: async (input) => {
        const [purchaseOrders, stockPickings] = await fetchDemandRows(
          qc,
          organizationId,
        )
        return observeReplenishmentExecution(
          input,
          input.snapshot,
          purchaseOrders,
          stockPickings,
        )
      },
    }),
    [companyId, organizationId, qc],
  )

  const execute = useMemo(
    () =>
      async (
        input: ExecuteReplenishmentRuleInput,
        context?: { navigateToNext?: boolean },
      ) => {
        const [purchaseOrders, stockPickings] = await fetchDemandRows(
          qc,
          organizationId,
        )
        const snapshot = captureReplenishmentExecutionSnapshot(
          input,
          purchaseOrders,
          stockPickings,
        )
        if (!snapshot) {
          throw new WorkflowError(
            "validation",
            "Replenishment demand target is ambiguous",
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
