/** Loose row shape for org-scoped master data affected by CSV import reducers. */
export type OrgMasterCsvImportQueryRow = Record<string, unknown>;

/** Primary label for imported master rows (country, currency, role, etc.). */
export function orgMasterCsvImportPrimaryLabel(
  row: OrgMasterCsvImportQueryRow,
): string {
  const candidates = [row.name, row.code, row.symbol];
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
