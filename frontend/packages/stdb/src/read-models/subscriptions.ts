/** Loose row shape from `/api/query/subscriptions` (and similar subscription lists). */
export type SubscriptionQueryRow = Record<string, unknown>;

/** Primary label for subscription rows (name, plan, partner). */
export function subscriptionPrimaryLabel(row: SubscriptionQueryRow): string {
  const candidates = [row.name, row.planName, row.partnerName, row.reference];
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
