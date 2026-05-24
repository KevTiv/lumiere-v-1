/** Loose row shape from `/api/query/roles` (and similar auth lists). */
export type AuthRoleQueryRow = Record<string, unknown>;

/** Primary label for role rows. */
export function authRolePrimaryLabel(row: AuthRoleQueryRow): string {
  const name = row.name;
  if (typeof name === "string") {
    const t = name.trim();
    if (t.length > 0) return t;
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
