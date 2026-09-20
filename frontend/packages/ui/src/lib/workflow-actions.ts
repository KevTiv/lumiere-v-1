import { canPresentToAny, type AnyWorkflowAction } from "@lumiere/erp-workflows"
import type { EntityAction, EntityActionConfirmation } from "./entity-view-types"

type Row = Record<string, unknown>

/**
 * Render workflow actions as table toolbar actions. State gating comes from `canPresent`;
 * enabled when any selected row qualifies; dispatch runs `prepare` per qualifying row and hands the result to the action's `execute`.
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
        isApplicable: (rows: Row[]) => canPresentToAny(action, rows),
        onClick: (rows: Row[]) => {
          for (const row of rows) {
            if (!action.canPresent(row)) continue
            action
              .execute(prepare(row), { navigateToNext: rows.length === 1 })
              .catch((error: unknown) => options.onError?.(error, action))
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
  rows: ReadonlyArray<Record<string, unknown>>,
): void {
  for (const row of rows) {
    const id = row.id
    if (id != null) action.execute(String(id)).catch(() => undefined)
  }
}
