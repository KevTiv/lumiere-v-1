/** Loose row shape from `/api/query/documents` (and similar document lists). */
export type DocumentQueryRow = Record<string, unknown>;

/** Primary label for document rows (name, title, file name). */
export function documentPrimaryLabel(row: DocumentQueryRow): string {
  const candidates = [row.name, row.title, row.fileName, row.displayName];
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
