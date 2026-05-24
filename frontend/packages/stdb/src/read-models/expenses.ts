/** Loose row shape from `/api/query/expenses` (and similar expense lists). */
export type ExpenseQueryRow = Record<string, unknown>;

/** Primary label for expense rows (description, then name). */
export function expensePrimaryLabel(row: ExpenseQueryRow): string {
  const candidates = [row.description, row.name];
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
