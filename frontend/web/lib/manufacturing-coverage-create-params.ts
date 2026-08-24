import type { CreateLossCategoryParams } from "@lumiere/stdb/types"

import {
  field,
  num,
  optionalBigIntU64,
  optionalTrimmedString,
} from "@lumiere/erp-shared/create-params-helpers"

export function toCreateLossCategoryParams(
  formData: Record<string, unknown>,
): CreateLossCategoryParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const category = optionalTrimmedString(field(formData, "category", "category"))
  if (!name || !category) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    name,
    category,
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
