/** Loose row shape for org-scoped master data affected by CSV import reducers. */
export type OrgMasterCsvImportQueryRow = Record<string, unknown>;

/** Primary label for imported master rows (country, currency, role, etc.). */
export function orgMasterCsvImportPrimaryLabel(
  row: OrgMasterCsvImportQueryRow,
): string {
  return primaryLabel([row.name, row.code, row.symbol], row.id);
}
import { primaryLabel } from "./primary-label";
