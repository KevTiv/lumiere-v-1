/** Loose row shape from `/api/query/employees` (and similar HR lists). */
export type HrQueryRow = Record<string, unknown>;

/** Primary label for employee rows. */
export function employeePrimaryLabel(row: HrQueryRow): string {
  const candidates = [row.name, row.displayName, row.workEmail];
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
