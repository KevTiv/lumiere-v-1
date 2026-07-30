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
