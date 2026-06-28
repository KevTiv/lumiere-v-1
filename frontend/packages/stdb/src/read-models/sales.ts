/** Loose row shape from `/api/query/sale-orders` (and similar order lists). */
export type SalesOrderQueryRow = Record<string, unknown>;

/** Unwrap SpacetimeDB HTTP/SATS cells (Option `some`, unit enums, tagged enums). */
export function unwrapStdbScalarString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value).trim();
  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if ("some" in o) return unwrapStdbScalarString(o.some);
    if ("none" in o) return "";
    if ("tag" in o) return String(o.tag).trim();
    const keys = Object.keys(o);
    if (keys.length === 1 && Array.isArray(o[keys[0]!]) && (o[keys[0]!] as unknown[]).length === 0) {
      const k = keys[0]!;
      return k.charAt(0).toUpperCase() + k.slice(1);
    }
  }
  return String(value).trim();
}

/** Primary label for sale order rows (reference / client ref / partner). */
export function saleOrderPrimaryLabel(row: SalesOrderQueryRow): string {
  const candidates = [
    row.reference,
    row.clientOrderRef,
    row.client_order_ref,
    row.name,
    row.partnerName,
    row.partner_name,
  ];
  for (const c of candidates) {
    const t = unwrapStdbScalarString(c);
    if (t.length > 0) return t;
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
