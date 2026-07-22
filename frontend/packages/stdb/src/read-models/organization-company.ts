/** Loose row shape from `/api/query/companies` (and similar org/company lists). */
export type OrganizationCompanyQueryRow = Record<string, unknown>;

/** Primary label for company rows in pickers and lists. */
export function companyPrimaryLabel(row: OrganizationCompanyQueryRow): string {
  return primaryLabel([row.name, row.companyName, row.legalName], row.id);
}
import { primaryLabel } from "./primary-label";
