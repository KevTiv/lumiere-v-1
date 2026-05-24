/**
 * When `user_type_id` is not supplied by the client, derive a stable default from
 * the chart account group. Values align with common Odoo-style account type ids.
 *
 * Prefer {@link userTypeIdFromAccountTypes}: SpacetimeDB uses auto-inc ids, so fixed
 * 1–6 only match accidentally after seed order changes.
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

function slugFromAccountInternalGroupField(v: unknown): string {
  if (v != null && typeof v === "object" && "tag" in v) {
    const tag = String((v as { tag?: string }).tag ?? "")
    if (!tag) return ""
    return tag.charAt(0).toLowerCase() + tag.slice(1)
  }
  return String(v ?? "").toLowerCase()
}

/** First account type whose internal group matches the form slug (`asset`, `income`, …). */
export function userTypeIdFromAccountTypes(
  accountTypes: ReadonlyArray<Record<string, unknown>>,
  internalGroupSlug: string | undefined,
): bigint | undefined {
  const want = String(internalGroupSlug ?? "").toLowerCase()
  if (!want) return undefined
  for (const row of accountTypes) {
    const ig =
      row.internalGroup ?? (row as Record<string, unknown>).internal_group
    if (slugFromAccountInternalGroupField(ig) !== want) continue
    const id = row.id
    if (id == null || id === "") continue
    try {
      return BigInt(String(id))
    } catch {
      continue
    }
  }
  return undefined
}
