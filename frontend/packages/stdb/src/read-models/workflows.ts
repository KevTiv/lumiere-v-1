/** Loose row shape from `/api/query/workflows` (and similar workflow lists). */
export type WorkflowQueryRow = Record<string, unknown>;

/** Primary label for workflow rows (name, code). */
export function workflowPrimaryLabel(row: WorkflowQueryRow): string {
  const candidates = [row.name, row.code, row.title];
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
