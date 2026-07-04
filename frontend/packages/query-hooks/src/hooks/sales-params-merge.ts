import type { UpdateSaleOrderParams } from "@lumiere/stdb/types"

import { pickDefined } from "./params-merge-utils"

/** Strip undefined keys from Sales update patches before `stdbParamsToJson`. */
export function finalizeUpdateSaleOrderParams(
  partial: Partial<UpdateSaleOrderParams>,
): UpdateSaleOrderParams {
  return pickDefined(partial)
}
