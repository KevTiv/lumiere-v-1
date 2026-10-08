export interface ProcurementScoreInput {
  countryPackKey: string
  scoreKind: string
  scoreValue: number
  maxValue: number
  notes: string | null
}

export type ProcurementScoreParseResult =
  | { ok: true; value: ProcurementScoreInput }
  | { ok: false; reason: "required" | "number" }

export interface ProcurementScoreView {
  id: string
  countryPackKey: string
  scoreKind: string
  scoreValue: number
  maxValue: number
  notes: string
}

function unwrapSome(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) return (value as { some: unknown }).some
    if ("none" in value && Object.keys(value).length === 1) return null
  }
  return value
}

function finiteNumber(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * `upsert_proposal_procurement_score` requires a non-blank country pack key and score kind and
 * performs no range check on the numbers, so only finiteness is enforced here. A row is
 * identified by (country pack key, score kind): submitting an existing pair updates that row.
 */
export function parseProcurementScoreInput(
  values: Record<string, unknown> | null | undefined,
): ProcurementScoreParseResult {
  const countryPackKey = String(values?.countryPackKey ?? "").trim()
  const scoreKind = String(values?.scoreKind ?? "").trim()
  if (countryPackKey === "" || scoreKind === "") return { ok: false, reason: "required" }
  const scoreValue = finiteNumber(values?.scoreValue)
  const maxValue = finiteNumber(values?.maxValue)
  if (scoreValue == null || maxValue == null) return { ok: false, reason: "number" }
  const notes = String(values?.notes ?? "").trim()
  return {
    ok: true,
    value: { countryPackKey, scoreKind, scoreValue, maxValue, notes: notes === "" ? null : notes },
  }
}

/** This proposal's score rows, normalised and ordered by country pack then score kind. */
export function procurementScoresForProposal(
  rows: readonly Record<string, unknown>[],
  proposalId: bigint | number | string,
): ProcurementScoreView[] {
  const wanted = String(proposalId)
  return rows
    .filter((row) => String(row.proposalId ?? row.proposal_id ?? "") === wanted)
    .map((row) => ({
      id: String(row.id ?? ""),
      countryPackKey: String(row.countryPackKey ?? row.country_pack_key ?? ""),
      scoreKind: String(row.scoreKind ?? row.score_kind ?? ""),
      scoreValue: finiteNumber(row.scoreValue ?? row.score_value) ?? 0,
      maxValue: finiteNumber(row.maxValue ?? row.max_value) ?? 0,
      notes: String(unwrapSome(row.notes) ?? ""),
    }))
    .sort(
      (a, b) =>
        a.countryPackKey.localeCompare(b.countryPackKey) || a.scoreKind.localeCompare(b.scoreKind),
    )
}
