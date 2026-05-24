/** Loose row shape from `/api/query/projects` (and similar project lists). */
export type ProjectsQueryRow = Record<string, unknown>;

/** Primary label for project rows. */
export function projectPrimaryLabel(row: ProjectsQueryRow): string {
  const candidates = [row.name, row.displayName, row.code];
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
