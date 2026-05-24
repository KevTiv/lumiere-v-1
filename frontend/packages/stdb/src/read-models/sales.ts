/** Loose row shape from `/api/query/sale-orders` (and similar order lists). */
export type SalesOrderQueryRow = Record<string, unknown>;

/** Primary label for sale order rows (reference / client ref / partner). */
export function saleOrderPrimaryLabel(row: SalesOrderQueryRow): string {
  const candidates = [
    row.reference,
    row.clientOrderRef,
    row.name,
    row.partnerName,
  ];
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
