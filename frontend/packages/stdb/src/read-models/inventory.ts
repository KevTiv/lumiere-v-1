/** Loose row shape from `/api/query/products` (and similar product lists). */
export type InventoryProductQueryRow = Record<string, unknown>;

/** Combined internal reference + display name for product rows. */
export function inventoryProductPrimaryLabel(row: InventoryProductQueryRow): string {
  const rawCode = row.defaultCode ?? row.default_code;
  const code =
    typeof rawCode === "string"
      ? rawCode.trim()
      : String(rawCode ?? "").trim();
  const name =
    typeof row.name === "string" ? row.name.trim() : String(row.name ?? "").trim();
  const combined = [code, name].filter((s) => s.length > 0).join(" ");
  if (combined) return combined;
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
