/** Loose row shape from `/api/query/proposals` (and similar proposal lists). */
export type ProposalQueryRow = Record<string, unknown>;

/** Primary label for proposal rows (title, then client). */
export function proposalPrimaryLabel(row: ProposalQueryRow): string {
  const candidates = [row.title, row.clientName, row.name];
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
