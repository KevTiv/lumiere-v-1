import { describe, expect, it } from "vitest"

import { parseProcurementScoreInput, procurementScoresForProposal } from "./procurement-score"

describe("parseProcurementScoreInput", () => {
  it("trims keys and turns blank notes into null", () => {
    expect(
      parseProcurementScoreInput({
        countryPackKey: " us ",
        scoreKind: " technical ",
        scoreValue: "7.5",
        maxValue: 10,
        notes: "  ",
      }),
    ).toEqual({
      ok: true,
      value: { countryPackKey: "us", scoreKind: "technical", scoreValue: 7.5, maxValue: 10, notes: null },
    })
  })

  it("accepts a zero score and keeps notes", () => {
    const result = parseProcurementScoreInput({
      countryPackKey: "us",
      scoreKind: "price",
      scoreValue: 0,
      maxValue: 100,
      notes: " weak ",
    })
    expect(result).toEqual({
      ok: true,
      value: { countryPackKey: "us", scoreKind: "price", scoreValue: 0, maxValue: 100, notes: "weak" },
    })
  })

  it("requires a country pack key and a score kind", () => {
    expect(parseProcurementScoreInput({ countryPackKey: "", scoreKind: "x", scoreValue: 1, maxValue: 2 })).toEqual({
      ok: false,
      reason: "required",
    })
    expect(parseProcurementScoreInput({ countryPackKey: "us", scoreKind: "  ", scoreValue: 1, maxValue: 2 })).toEqual({
      ok: false,
      reason: "required",
    })
    expect(parseProcurementScoreInput(null)).toEqual({ ok: false, reason: "required" })
  })

  it("rejects blank or non-numeric scores", () => {
    const base = { countryPackKey: "us", scoreKind: "x" }
    expect(parseProcurementScoreInput({ ...base, scoreValue: "", maxValue: 10 })).toEqual({ ok: false, reason: "number" })
    expect(parseProcurementScoreInput({ ...base, scoreValue: 1, maxValue: "abc" })).toEqual({ ok: false, reason: "number" })
    expect(parseProcurementScoreInput({ ...base, scoreValue: 1 })).toEqual({ ok: false, reason: "number" })
  })
})

describe("procurementScoresForProposal", () => {
  it("keeps only the proposal's rows, unwraps notes and sorts", () => {
    const rows = [
      { id: 3n, proposalId: 9n, countryPackKey: "us", scoreKind: "technical", scoreValue: 4, maxValue: 5, notes: { some: "ok" } },
      { id: 1n, proposalId: 9n, countryPackKey: "de", scoreKind: "price", scoreValue: 2, maxValue: 5, notes: { none: [] } },
      { id: 2n, proposalId: 8n, countryPackKey: "us", scoreKind: "price", scoreValue: 1, maxValue: 5 },
      { id: 4n, proposal_id: 9n, country_pack_key: "us", score_kind: "price", score_value: 3, max_value: 5, notes: null },
    ]
    expect(procurementScoresForProposal(rows, 9)).toEqual([
      { id: "1", countryPackKey: "de", scoreKind: "price", scoreValue: 2, maxValue: 5, notes: "" },
      { id: "4", countryPackKey: "us", scoreKind: "price", scoreValue: 3, maxValue: 5, notes: "" },
      { id: "3", countryPackKey: "us", scoreKind: "technical", scoreValue: 4, maxValue: 5, notes: "ok" },
    ])
  })
})
