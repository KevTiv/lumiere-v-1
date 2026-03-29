/**
 * Merge entity `metadata` JSON into react-hook-form default values for `custom:*` field IDs.
 * Expects parsed metadata to be a flat object with keys like `custom:my_key` (same keys as form fieldIds).
 */
export function defaultValuesFromMetadata(
  metadata: unknown,
  customFieldIds: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!metadata || customFieldIds.length === 0) return out

  let obj: Record<string, unknown> | null = null
  if (typeof metadata === "string") {
    try {
      const p = JSON.parse(metadata) as unknown
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        obj = p as Record<string, unknown>
      }
    } catch {
      return out
    }
  } else if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
    obj = metadata as Record<string, unknown>
  }
  if (!obj) return out

  for (const id of customFieldIds) {
    if (Object.prototype.hasOwnProperty.call(obj, id) && obj[id] !== undefined) {
      out[id] = obj[id]
    }
  }
  return out
}
