/**
 * Maps form-builder payloads to SpacetimeDB Create*Params types.
 */

import type { CreateFormConfigParams } from "@lumiere/stdb/types"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

export function toCreateFormConfigParams(
  formData: Record<string, unknown>,
): CreateFormConfigParams | null {
  const moduleId = String(formData.moduleId ?? formData.module_id ?? "").trim()
  const formId = String(formData.formId ?? formData.form_id ?? "").trim()
  const name = String(formData.name ?? "").trim()
  if (!moduleId || !formId || !name) return null
  return {
    moduleId,
    formId,
    name,
    description: optionalTrimmedString(formData.description),
    isSystemDefault: formData.isSystemDefault === true || formData.is_system_default === true,
  }
}
