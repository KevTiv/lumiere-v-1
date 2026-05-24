/** Loose row shape from `/api/query/financial-reports` (and similar report lists). */
export type ReportsQueryRow = Record<string, unknown>;

/** Primary label for financial report rows. */
export function financialReportPrimaryLabel(row: ReportsQueryRow): string {
  const candidates = [row.name, row.title, row.reportType];
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
