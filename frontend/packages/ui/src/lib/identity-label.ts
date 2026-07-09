/** Resolve SpacetimeDB identity values to display labels. */

export function identityToHex(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.trim().toLowerCase()
  if (typeof value === "object" && value !== null) {
    if ("toHex" in value) {
      const th = (value as { toHex: () => { toString: () => string } }).toHex
      if (typeof th === "function") return th.call(value).toString().toLowerCase()
    }
    if ("some" in value) return identityToHex((value as { some: unknown }).some)
  }
  return String(value).trim().toLowerCase()
}

export function resolveIdentityLabel(
  value: unknown,
  labelMap?: ReadonlyMap<string, string>,
): string {
  const hex = identityToHex(value)
  if (!hex) return "—"
  const mapped = labelMap?.get(hex)
  if (mapped) return mapped
  return hex.length > 10 ? `${hex.slice(0, 8)}…` : hex
}

export function buildIdentityLabelMap(
  users: readonly Record<string, unknown>[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const user of users) {
    const label = String(user.name ?? user.email ?? "").trim()
    if (!label) continue
    const keys = [
      user.id,
      user.identity,
      user.identityHex,
      user.userIdentity,
      user.user_identity,
    ]
    for (const key of keys) {
      const hex = identityToHex(key)
      if (hex) map.set(hex, label)
    }
  }
  return map
}
