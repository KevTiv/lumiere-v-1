import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

/** Encode the complete SATS shape, including explicit `none` values for absent options. */
export function toSubmitSupplierIntakeParams(params: object) {
  return stdbParamsToJson(params, "SubmitSupplierIntakeParams")
}
