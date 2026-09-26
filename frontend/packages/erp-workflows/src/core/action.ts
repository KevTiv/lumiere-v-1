import type { RowValueMap } from "@lumiere/erp-shared/row-values"
import { rowId } from "./row"
import type { WorkflowResult } from "./result"

/** How a surface should collect intent before executing. */
export type WorkflowActionKind =
  | "immediate"
  | "confirm"
  | "form"
  | "approval-wait"
  | "navigate"
  | "destructive"

/** Per-invocation facts only the dispatching surface knows. */
export interface WorkflowExecuteContext {
  /** Open the resulting record on success (a single-record run, not a bulk selection). */
  navigateToNext?: boolean
}

export interface WorkflowAction<TRecord, TInput = void> {
  id: string
  label: string
  kind: WorkflowActionKind
  /** Presentation only: never grants permission. The server re-authorizes every command. */
  canPresent(record: TRecord): boolean
  /** Why a presentable action is currently unavailable; shown instead of hiding when useful. */
  blockedReason?(record: TRecord): string | undefined
  /** Input for actions that need nothing beyond the record (immediate/confirm/destructive). */
  prepare?(record: TRecord): TInput
  execute(input: TInput, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}

/** A workflow action of any input type, for surfaces that only present and dispatch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWorkflowAction<TRecord> = WorkflowAction<TRecord, any>

export function presentableActions<TRecord>(
  actions: ReadonlyArray<AnyWorkflowAction<TRecord>>,
  record: TRecord,
): Array<AnyWorkflowAction<TRecord>> {
  return actions.filter((action) => action.canPresent(record))
}

/** True when every record qualifies (an empty selection never does). */
export function canPresentToAll<TRecord>(
  action: Pick<AnyWorkflowAction<TRecord>, "canPresent">,
  records: readonly TRecord[],
): boolean {
  return records.length > 0 && records.every((record) => action.canPresent(record))
}

/** True when at least one record qualifies; dispatch then skips the rest. */
export function canPresentToAny<TRecord>(
  action: Pick<AnyWorkflowAction<TRecord>, "canPresent">,
  records: readonly TRecord[],
): boolean {
  return records.some((record) => action.canPresent(record))
}

/** Executes a record action with the record's id (or another single-value input). */
export type ExecuteAction<TInput> = (input: TInput, context?: WorkflowExecuteContext) => Promise<WorkflowResult>

/** An action whose input is the record's id: presentation is a state gate, dispatch is `execute(rowId)`. */
export function recordAction(
  id: string,
  kind: WorkflowActionKind,
  canPresent: (row: RowValueMap) => boolean,
  options: { label: string; execute: ExecuteAction<string> },
): WorkflowAction<RowValueMap, string> {
  return { id, label: options.label, kind, canPresent, prepare: rowId, execute: options.execute }
}
