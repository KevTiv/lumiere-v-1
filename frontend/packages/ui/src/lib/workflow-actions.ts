import { canPresentToAny, type AnyWorkflowAction } from "@lumiere/erp-workflows"
import type { EntityAction, EntityActionConfirmation, EntityRow } from "./entity-view-types"

type Row = EntityRow

/**
 * Render workflow actions as table toolbar actions. State gating comes from `canPresent`;
 * enabled when any selected row qualifies; dispatch runs `prepare` per qualifying row and hands the result to the action's `execute`, and settles once every row has.
 * Actions without `prepare` (form-backed) are not table-dispatchable and are skipped.
 */
export function workflowActionsToEntityActions(
  actions: ReadonlyArray<AnyWorkflowAction<Row>>,
  options: {
    /** Keep an existing surface id (e.g. an e2e test id) for an action during migration. */
    ids?: Readonly<Record<string, string>>
    /**
     * Copy for the confirmation dialog shown before destructive/confirm-kind actions (the surface
     * owns translation). Omit to run them immediately.
     */
    confirmation?: Omit<EntityActionConfirmation, "title">
    /** Called for each failure so the surface can decide how to present the typed error. */
    onError?: (error: unknown, action: AnyWorkflowAction<Row>) => void
  } = {},
): EntityAction[] {
  return actions.flatMap((action) => {
    const prepare = action.prepare
    if (!prepare) return []
    return [
      {
        id: options.ids?.[action.id] ?? action.id,
        label: action.label,
        variant: action.kind === "destructive" ? ("destructive" as const) : undefined,
        confirm:
          options.confirmation && (action.kind === "destructive" || action.kind === "confirm")
            ? { title: action.label, ...options.confirmation }
            : undefined,
        requiresSelection: true,
        selection: "multiple" as const,
        isApplicable: (rows: Row[]) => canPresentToAny(action, rows),
        onClick: async (rows: Row[]) => {
          const outcomes = await Promise.allSettled(
            rows
              .filter((row) => action.canPresent(row))
              .map((row) => action.execute(prepare(row), { navigateToNext: rows.length === 1 })),
          )
          for (const outcome of outcomes) {
            if (outcome.status !== "rejected") continue
            // The workflow runner has already told the surface (its `notify` port), so rethrowing
            // would show the same failure in a second toast. `onError` is for extra handling.
            options.onError?.(outcome.reason, action)
          }
        },
      },
    ]
  })
}

/**
 * Runs a record action once per selected row, by the row's id. For toolbars whose selection gate
 * already requires every row to qualify. Failures are reported by the workflow surface, so the
 * rejection is only swallowed here to keep it from surfacing as an unhandled one.
 */
export function runRecordActionForRows(
  action: { execute(recordId: string): Promise<unknown> },
  rows: ReadonlyArray<EntityRow>,
): void {
  for (const row of rows) {
    const id = row.id
    if (id != null) action.execute(String(id)).catch(() => undefined)
  }
}
