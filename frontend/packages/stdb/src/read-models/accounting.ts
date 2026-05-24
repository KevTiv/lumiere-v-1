/** Loose row shape from `/api/query/account-accounts` (and similar GL lists). */
export type AccountingAccountQueryRow = Record<string, unknown>;

/** Single-cell label for chart-of-accounts rows (code + name). */
export function chartAccountPrimaryLabel(row: AccountingAccountQueryRow): string {
  const code =
    typeof row.code === "string" ? row.code.trim() : String(row.code ?? "").trim();
  const name =
    typeof row.name === "string" ? row.name.trim() : String(row.name ?? "").trim();
  const combined = [code, name].filter((s) => s.length > 0).join(" ");
  if (combined) return combined;
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
