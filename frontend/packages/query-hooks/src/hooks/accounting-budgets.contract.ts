/**
 * Compile-only — accounting budget query rows and mutation inputs stay pinned
 * to generated contract types. First vertical slice of
 * docs/plans/frontend-opaque-record-contract-migration-plan.md: proves the
 * query row map, typed create input, and `ClearablePatch` update input reject
 * opaque records at compile time. Never imported at runtime.
 */
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"
import type { CreateCrossoveredBudgetParams, CrossoveredBudget } from "@lumiere/stdb/types"

import { useCreateCrossoveredBudget, useCrossoveredBudgets, useUpdateBudgetLine, useUpdateCrossoveredBudget } from "./accounting"

function assertContracts() {
  // Positive: "budgets" resolves through the query row map to the generated row type.
  const budgetsRow: QueryRowFor<"budgets"> = null as unknown as CrossoveredBudget
  void budgetsRow

  // Positive: useCrossoveredBudgets infers the generated row type for `initialData`.
  useCrossoveredBudgets(1n, { initialData: [] as CrossoveredBudget[] })

  // @ts-expect-error `initialData` must match the generated `CrossoveredBudget` row shape.
  useCrossoveredBudgets(1n, { initialData: [{ notARealField: true }] })

  // Positive: create accepts the generated params shape.
  const createBudget = useCreateCrossoveredBudget(1)
  void createBudget.mutate({} as CreateCrossoveredBudgetParams)

  // @ts-expect-error create must not accept an opaque record in place of generated params.
  createBudget.mutate({ notARealField: true })

  // Positive: update accepts a `ClearablePatch` — `null` clears an optional field.
  const updateBudget = useUpdateCrossoveredBudget(1)
  void updateBudget.mutate({ budgetId: 1n, params: { description: null } })

  // @ts-expect-error update must reject fields absent from the generated params.
  updateBudget.mutate({ budgetId: 1n, params: { notARealField: 1 } })

  const updateBudgetLine = useUpdateBudgetLine(1)
  void updateBudgetLine.mutate({ lineId: 1n, params: { analyticAccountId: null } })

  // @ts-expect-error update must reject fields absent from the generated params.
  updateBudgetLine.mutate({ lineId: 1n, params: { notARealField: 1 } })
}

void assertContracts
