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

/**
 * Extract `custom:*` field values from form data into a JSON metadata string.
 * Merges with an existing metadata object when `existingMetadata` is provided.
 */
export function metadataFromCustomFields(
  formData: Record<string, unknown>,
  customFieldIds: readonly string[],
  existingMetadata?: unknown,
): string | undefined {
  if (customFieldIds.length === 0) return undefined

  let base: Record<string, unknown> = {}
  if (existingMetadata != null) {
    if (typeof existingMetadata === "string") {
      try {
        const parsed = JSON.parse(existingMetadata) as unknown
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          base = { ...(parsed as Record<string, unknown>) }
        }
      } catch {
        base = {}
      }
    } else if (typeof existingMetadata === "object" && !Array.isArray(existingMetadata)) {
      base = { ...(existingMetadata as Record<string, unknown>) }
    }
  }

  let changed = false
  for (const id of customFieldIds) {
    if (Object.prototype.hasOwnProperty.call(formData, id)) {
      base[id] = formData[id]
      changed = true
    }
  }

  if (!changed && Object.keys(base).length === 0) return undefined
  return JSON.stringify(base)
}

/** Split form submit payload: core reducer fields vs custom field map. */
export function splitCustomFieldValues(
  formData: Record<string, unknown>,
  customFieldIds: readonly string[],
): { core: Record<string, unknown>; custom: Record<string, unknown> } {
  const core = { ...formData }
  const custom: Record<string, unknown> = {}
  for (const id of customFieldIds) {
    if (Object.prototype.hasOwnProperty.call(core, id)) {
      custom[id] = core[id]
      delete core[id]
    }
  }
  return { core, custom }
}
