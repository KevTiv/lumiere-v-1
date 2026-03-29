/** Normalize SpacetimeDB algebraic / string enums for helpdesk tables and filters. */

/** Stable hex for comparing `user_id` / profile `identity` (lowercase, no 0x). */
export function identityToHex(v: unknown): string {
  if (v == null || v === "") return ""
  if (typeof v === "string") {
    return v.trim().replace(/^0x/i, "").toLowerCase()
  }
  if (typeof v === "object" && v !== null && "__identity__" in (v as object)) {
    return String((v as { __identity__: string }).__identity__)
      .trim()
      .replace(/^0x/i, "")
      .toLowerCase()
  }
  return String(v)
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase()
}

export function helpdeskEnumTag(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const keys = Object.keys(v as object)
    if (keys.length === 1) return keys[0] ?? ""
  }
  return String(v)
}

const PRI_MAP: Record<string, string> = {
  Low: "low",
  Normal: "normal",
  High: "high",
  Urgent: "urgent",
}

/** Maps ticket row for table badges/filters (priority keys match `priorityBadges` in entity config). */
export function normalizeHelpdeskTicketRow(row: Record<string, unknown>): Record<string, unknown> {
  const pr = helpdeskEnumTag(row.priority)
  return {
    ...row,
    state: helpdeskEnumTag(row.state),
    priority: PRI_MAP[pr] ?? String(pr).toLowerCase(),
  }
}
