/** Loose row shape from `/api/query/purchase-orders` (and similar purchasing lists). */
export type PurchasingQueryRow = Record<string, unknown>;

/** Primary label for purchase order rows (name / reference / partner). */
export function purchaseOrderPrimaryLabel(row: PurchasingQueryRow): string {
  const candidates = [row.name, row.reference, row.partnerName, row.vendorName];
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
