/** Loose row shape from `/api/query/helpdesk-tickets` (and similar helpdesk lists). */
export type HelpdeskTicketQueryRow = Record<string, unknown>;

/** Primary label for helpdesk ticket rows (subject, reference, number). */
export function helpdeskTicketPrimaryLabel(row: HelpdeskTicketQueryRow): string {
  return primaryLabel([row.subject, row.name, row.reference, row.ticketNumber], row.id);
}
import { primaryLabel } from "./primary-label";
