/** Loose row shape from `/api/query/helpdesk-tickets` (and similar helpdesk lists). */
export type HelpdeskTicketQueryRow = Record<string, unknown>;

/** Primary label for helpdesk ticket rows (subject, reference, number). */
export function helpdeskTicketPrimaryLabel(row: HelpdeskTicketQueryRow): string {
  const candidates = [row.subject, row.name, row.reference, row.ticketNumber];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
