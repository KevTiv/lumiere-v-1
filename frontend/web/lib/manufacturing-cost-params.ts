import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export function toManufacturingValuationParams(values: Record<string, unknown>): OperationInputMap["configure_manufacturing_valuation"]["params"] {
  const required = (field: string) => {
    const id = parseStrictU64(values[field])
    if (id == null || id <= 0n) throw new Error("Select a journal and each valuation account")
    return id
  }
  return {
    journalId: required("journalId"),
    materialAccountId: required("materialAccountId"),
    outputAccountId: required("outputAccountId"),
    workcenterAccountId: required("workcenterAccountId"),
    varianceAccountId: required("varianceAccountId"),
  }
}
