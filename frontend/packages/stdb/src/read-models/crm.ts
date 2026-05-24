/** Loose row shape from `/api/query/contacts` (and similar CRM lists). */
export type CrmQueryRow = Record<string, unknown>;

/** Primary label for contact / partner rows in pickers and lists. */
export function contactPrimaryLabel(row: CrmQueryRow): string {
  const candidates = [row.name, row.partnerName, row.companyName, row.contactName];
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
