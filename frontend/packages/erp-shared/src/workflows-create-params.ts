/**
 * Maps Workflows module form payloads to SpacetimeDB Create*Params types.
 */

import type { CreateWorkflowParams } from "@lumiere/stdb/types"

function field(formData: Record<string, unknown>, camel: string, snake: string): unknown {
  return formData[camel] ?? formData[snake]
}

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

export function toCreateWorkflowParams(
  formData: Record<string, unknown>,
): CreateWorkflowParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  const model = String(field(formData, "model", "model") ?? "").trim()
  const stateField = String(field(formData, "stateField", "state_field") ?? "").trim()
  if (!name || !model || !stateField) return null
  return {
    name,
    model,
    stateField,
    onCreate: field(formData, "onCreate", "on_create") === true,
    isActive: field(formData, "isActive", "is_active") !== false,
    description: optionalTrimmedString(field(formData, "description", "description")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
