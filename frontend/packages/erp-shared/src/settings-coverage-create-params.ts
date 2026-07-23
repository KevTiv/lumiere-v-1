/** Auto-generated Create*Params mappers for settings coverage gap. */

import type {
  CreateSodConflictRuleParams,
} from "@lumiere/stdb/types"

import {
  field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
  num,
  stringArrayFromForm,
  optionalTimestampFromForm,
  requiredTimestampFromForm,
  optionalIdentityFromForm,
  requiredIdentityFromForm,
  identityArrayFromForm,
  unitEnumFromForm,
  unitEnumArrayFromForm,
  messageChannelArrayFromForm,
  objectArrayFromForm,
  stbTimestampFromDate,
} from "./create-params-helpers"

export function toCreateSodConflictRuleParams(
  formData: Record<string, unknown>,
): CreateSodConflictRuleParams | null {
  const permissionA = optionalTrimmedString(field(formData, "permissionA", "permission_a"))
  const permissionB = optionalTrimmedString(field(formData, "permissionB", "permission_b"))
  if (!permissionA || !permissionB) return null

  return {
    permissionA,
    permissionB,
    description: optionalTrimmedString(field(formData, "description", "description")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

