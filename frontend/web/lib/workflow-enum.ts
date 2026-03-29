/** SpacetimeDB sum types serialize as `{ Tag: ... }` — extract tag for filters and badges. */

export function instanceStateTag(state: unknown): "Active" | "Complete" | "Exception" | "" {
  if (state == null) return ""
  if (typeof state === "object" && state !== null && !Array.isArray(state)) {
    const k = Object.keys(state as object)[0]
    if (k === "Active" || k === "Complete" || k === "Exception") return k
  }
  return ""
}

export function workitemStateTag(state: unknown): "Active" | "Complete" | "Exception" | "Dummy" | "" {
  if (state == null) return ""
  if (typeof state === "object" && state !== null && !Array.isArray(state)) {
    const k = Object.keys(state as object)[0]
    if (k === "Active" || k === "Complete" || k === "Exception" || k === "Dummy") return k
  }
  return ""
}
