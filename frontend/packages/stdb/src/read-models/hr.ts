/** Loose row shape from `/api/query/employees` (and similar HR lists). */
export type HrQueryRow = Record<string, unknown>;

/** Primary label for employee rows. */
export function employeePrimaryLabel(row: HrQueryRow): string {
  return primaryLabel([row.name, row.displayName, row.workEmail], row.id);
}
import { primaryLabel } from "./primary-label";
