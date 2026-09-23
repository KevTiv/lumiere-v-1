import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  QUALITY_CHECK_FAIL_AFFECTS,
  WorkflowError,
  captureQualityCheckFailSnapshot,
  observeQualityCheckFail,
  type FailQualityCheckInput,
  type QualityCheckFailSnapshot,
  type RowValueMap,
  type TransitionSpec,
} from "@lumiere/erp-workflows"

import { failQualityCheckCommand } from "./inventory/quality"
import { stockQuantsQueryOptions } from "./inventory/stock-operations"
import {
  useWorkflowRunner,
  type WorkflowSurfaceCallbacks,
} from "./workflow"

type FailRunInput = FailQualityCheckInput & {
  snapshot: QualityCheckFailSnapshot
}

export function useQualityCheckFailWorkflow(
  organizationId: bigint,
  companyId: bigint,
  callbacks?: WorkflowSurfaceCallbacks,
) {
  const qc = useQueryClient()
  const runner = useWorkflowRunner(organizationId, callbacks)

  const spec = useMemo<TransitionSpec<FailRunInput>>(
    () => ({
      id: "inventory.quality-check.fail",
      command: (input) =>
        failQualityCheckCommand(companyId, {
          checkId: input.checkId,
          qtyFailed: input.qtyFailed,
          note: input.note,
          failureLocationId: input.quarantineLocationId,
        }),
      affects: QUALITY_CHECK_FAIL_AFFECTS,
      observe: async (input) =>
        observeQualityCheckFail(
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

  const fail = useMemo(
    () =>
      async (
        input: FailQualityCheckInput,
        context?: { navigateToNext?: boolean },
      ) => {
        if (!Number.isFinite(input.qtyFailed) || input.qtyFailed <= 0) {
          throw new WorkflowError(
            "validation",
            "Failed quantity must be greater than zero",
          )
        }

        const rows = (await qc.fetchQuery({
          ...stockQuantsQueryOptions(organizationId),
          staleTime: 0,
        })) as unknown as RowValueMap[]
        const snapshot = captureQualityCheckFailSnapshot(input, rows)
        if (!snapshot) {
          throw new WorkflowError(
            "validation",
            "Quality check source/quarantine quant relation is missing or ambiguous",
          )
        }

        const runInput: FailRunInput = { ...input, snapshot }
        return runner.run(
          `${spec.id}:${input.checkId}`,
          spec,
          runInput,
          { navigateToNext: context?.navigateToNext },
        )
      },
    [organizationId, qc, runner, spec],
  )

  return {
    fail,
    isRunning: runner.isRunning,
    isPending: runner.isPending,
  }
}
