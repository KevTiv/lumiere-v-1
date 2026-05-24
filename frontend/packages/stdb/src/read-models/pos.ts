/** Loose row shape from `/api/query/pos-terminals` (and similar POS lists). */
export type PosTerminalQueryRow = Record<string, unknown>;

/** Primary label for POS terminal rows (name, location). */
export function posTerminalPrimaryLabel(row: PosTerminalQueryRow): string {
  const candidates = [row.name, row.locationLabel, row.terminalName];
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
