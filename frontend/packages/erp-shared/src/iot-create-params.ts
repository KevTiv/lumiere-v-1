/**
 * Maps IoT module form payloads to SpacetimeDB Create*Params types.
 */

import type { CreateActionParams } from "@lumiere/stdb/types"

function field(formData: Record<string, unknown>, camel: string, snake: string): unknown {
  return formData[camel] ?? formData[snake]
}

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

export function toCreateActionParams(
  formData: Record<string, unknown>,
): CreateActionParams | null {
  const actionType = String(field(formData, "actionType", "action_type") ?? "").trim()
  const payload = String(field(formData, "payload", "payload") ?? "").trim()
  const triggeredBy = String(field(formData, "triggeredBy", "triggered_by") ?? "").trim()
  if (!actionType || !payload || !triggeredBy) return null
  return {
    actionType,
    payload,
    triggeredBy,
  }
}
