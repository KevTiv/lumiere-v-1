/** Loose row shape for organization / settings records. */
export type SettingsQueryRow = Record<string, unknown>;

/** Primary label for organization rows in settings UI. */
export function organizationPrimaryLabel(row: SettingsQueryRow): string {
  const candidates = [row.name, row.organizationName, row.displayName];
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
