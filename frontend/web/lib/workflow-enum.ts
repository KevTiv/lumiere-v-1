/** SpacetimeDB sum types serialize as `{ Tag: ... }` or `{ tag: "Tag" }`. */

function enumTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (typeof obj.tag === "string") return obj.tag
    const k = Object.keys(obj)[0]
    return k ?? ""
  }
  return ""
}

export type InstanceStateTag = "Active" | "Completed" | "Cancelled" | "Failed" | ""

export function instanceStateTag(state: unknown): InstanceStateTag {
  const k = enumTag(state)
  if (k === "Active" || k === "Completed" || k === "Cancelled" || k === "Failed") return k
  // Legacy Complete/Exception aliases
  if (k === "Complete") return "Completed"
  if (k === "Exception") return "Failed"
  return ""
}

export function versionStatusTag(
  status: unknown,
): "Draft" | "Published" | "Retired" | "" {
  const k = enumTag(status)
  if (k === "Draft" || k === "Published" || k === "Retired") return k
  return ""
}

/** @deprecated workitems removed */
export function workitemStateTag(
  state: unknown,
): "Active" | "Complete" | "Exception" | "Dummy" | "" {
  const k = enumTag(state)
  if (k === "Active" || k === "Complete" || k === "Exception" || k === "Dummy") return k
  return ""
}
