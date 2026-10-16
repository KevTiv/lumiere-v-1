import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

/** Encode the complete SATS shape, including explicit `none` values for absent options. */
export function toSubmitSupplierIntakeParams(params: Record<string, unknown>) {
  return stdbParamsToJson(params, "SubmitSupplierIntakeParams")
}
