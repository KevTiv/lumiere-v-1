/**
 * Maps Reports pivot / saved-definition payloads to SpacetimeDB Create*Params types.
 */

import type { CreateSavedReportParams } from "@lumiere/stdb/types"
import { formValue } from "./form-coercion"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

export function toCreateSavedReportParams(
  formData: Record<string, unknown>,
): CreateSavedReportParams | null {
  const name = String(formData.name ?? "").trim()
  if (!name) return null
  const columnRaw = formValue(formData, "columnDimension", "column_dimension")
  const columnDimension =
    columnRaw == null || String(columnRaw).trim() === "" ? undefined : String(columnRaw)
  return {
    name,
    model: String(formData.model ?? "trial_balance"),
    rowDimension: String(formValue(formData, "rowDimension", "row_dimension") ?? "accountCode"),
    columnDimension,
    measureField: String(formValue(formData, "measureField", "measure_field") ?? "closingDebit"),
    measureOp: String(formValue(formData, "measureOp", "measure_op") ?? "sum"),
    filterJson: optionalTrimmedString(formValue(formData, "filterJson", "filter_json")),
    isActive: formData.isActive !== false && formData.is_active !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}
