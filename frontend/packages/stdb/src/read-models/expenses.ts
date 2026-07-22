/** Loose row shape from `/api/query/expenses` (and similar expense lists). */
export type ExpenseQueryRow = Record<string, unknown>;

/** Primary label for expense rows (description, then name). */
export function expensePrimaryLabel(row: ExpenseQueryRow): string {
  return primaryLabel([row.description, row.name], row.id);
}
import { primaryLabel } from "./primary-label";
