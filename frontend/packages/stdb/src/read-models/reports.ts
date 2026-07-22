/** Loose row shape from `/api/query/financial-reports` (and similar report lists). */
export type ReportsQueryRow = Record<string, unknown>;

/** Primary label for financial report rows. */
export function financialReportPrimaryLabel(row: ReportsQueryRow): string {
  return primaryLabel([row.name, row.title, row.reportType], row.id);
}
import { primaryLabel } from "./primary-label";
