/** Loose row shape from `/api/query/contacts` (and similar CRM lists). */
export type CrmQueryRow = Record<string, unknown>;

/** Primary label for contact / partner rows in pickers and lists. */
export function contactPrimaryLabel(row: CrmQueryRow): string {
  return primaryLabel([row.name, row.partnerName, row.companyName, row.contactName], row.id);
}
import { primaryLabel } from "./primary-label";
