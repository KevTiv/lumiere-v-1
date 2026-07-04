import type { UpdateProductParams } from "@lumiere/stdb/types"

import { pickDefined } from "./params-merge-utils"

/** Strip undefined keys from Inventory update patches before `stdbParamsToJson`. */
export function finalizeUpdateProductParams(
  partial: Partial<UpdateProductParams>,
): UpdateProductParams {
  return pickDefined(partial)
}
