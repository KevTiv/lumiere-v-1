/** Loose row shape from `/api/query/workflows` (and similar workflow lists). */
export type WorkflowQueryRow = Record<string, unknown>;

/** Primary label for workflow rows (name, code). */
export function workflowPrimaryLabel(row: WorkflowQueryRow): string {
  return primaryLabel([row.name, row.code, row.title], row.id);
}
import { primaryLabel } from "./primary-label";
