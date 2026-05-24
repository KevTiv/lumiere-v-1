/** Loose row shape from `/api/query/companies` (and similar org/company lists). */
export type OrganizationCompanyQueryRow = Record<string, unknown>;

/** Primary label for company rows in pickers and lists. */
export function companyPrimaryLabel(row: OrganizationCompanyQueryRow): string {
  const candidates = [row.name, row.companyName, row.legalName];
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
