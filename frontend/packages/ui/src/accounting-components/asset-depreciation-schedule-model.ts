import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import {
  resolveAccountAssetDepreciationBoardEffect,
  type AccountAssetDepreciationLineProjection,
} from "@lumiere/query-hooks/hooks/accounting"
import { kpiDate } from "../lib/kpi-tiles"

export interface ScheduleAsset {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly name?: unknown
  readonly state?: unknown
}

export interface SavedDepreciationLine extends AccountAssetDepreciationLineProjection {
  readonly name?: unknown
  readonly amount?: unknown
  readonly depreciationDate?: unknown
  readonly depreciation_date?: unknown
  readonly remainingValue?: unknown
  readonly remaining_value?: unknown
  readonly depreciatedValue?: unknown
  readonly depreciated_value?: unknown
}

export interface ScheduleLine {
  readonly id: string
  readonly sequence: number
  readonly date: string | null
  readonly amount: number | null
  readonly remaining: number | null
  readonly depreciated: number | null
}

export type SavedAssetSchedule =
  | { readonly status: "unavailable" }
  | { readonly status: "not-generated" }
  | {
      readonly status: "saved"
      readonly lines: readonly ScheduleLine[]
      readonly incomplete: boolean
    }

function savedNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Number(value)
  return null
}

/** Read only the exact saved board. No dates, installments, or balances are calculated here. */
export function savedAssetSchedule(
  asset: ScheduleAsset,
  rows: readonly SavedDepreciationLine[],
  companyId: bigint,
): SavedAssetSchedule {
  const assetId = parseStrictU64(asset.id)
  if (assetId == null || parseStrictU64(asset.companyId ?? asset.company_id) !== companyId) {
    return { status: "unavailable" }
  }
  const matches = rows.filter((row) => parseStrictU64(row.assetId ?? row.asset_id) === assetId)
  if (matches.length === 0) return { status: "not-generated" }
  try {
    const board = resolveAccountAssetDepreciationBoardEffect(matches, companyId, assetId)
    if (!board) return { status: "unavailable" }
    const byId = new Map(matches.map((row) => [parseStrictU64(row.id)?.toString(), row]))
    const lines = board.lineIds.map((id, index): ScheduleLine => {
      const row = byId.get(id)!
      return {
        id,
        sequence: index + 1,
        date:
          kpiDate(row.depreciationDate ?? row.depreciation_date)
            ?.toISOString()
            .slice(0, 10) ?? null,
        amount: savedNumber(row.amount),
        remaining: savedNumber(row.remainingValue ?? row.remaining_value),
        depreciated: savedNumber(row.depreciatedValue ?? row.depreciated_value),
      }
    })
    return {
      status: "saved",
      lines,
      incomplete: lines.some((line) => Object.values(line).some((value) => value == null)),
    }
  } catch {
    // Conflicting identities are unavailable, rather than an empty board that can be regenerated.
    return { status: "unavailable" }
  }
}
