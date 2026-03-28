/**
 * When `user_type_id` is not supplied by the client, derive a stable default from
 * the chart account group. Values align with common Odoo-style account type ids.
 */
export function userTypeIdFromInternalGroup(internalGroup: string | undefined): bigint | undefined {
  const g = String(internalGroup ?? "").toLowerCase()
  const map: Record<string, number> = {
    asset: 1,
    liability: 2,
    equity: 3,
    income: 4,
    expense: 5,
    other: 6,
  }
  const n = map[g]
  return n != null ? BigInt(n) : undefined
}
