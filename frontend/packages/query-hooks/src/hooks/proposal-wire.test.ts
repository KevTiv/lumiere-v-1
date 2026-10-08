import assert from "node:assert/strict"
import test from "node:test"

import { stdbParamsToJson } from "@lumiere/stdb/stdb-params-json"

test("procurement score wire JSON keeps zero scores and spells notes as Option", () => {
  const withNotes = stdbParamsToJson(
    { countryPackKey: "us", scoreKind: "price", scoreValue: 0, maxValue: 10, notes: "weak" },
    "UpsertProposalProcurementScoreParams",
  )
  assert.deepEqual(withNotes, {
    country_pack_key: "us",
    score_kind: "price",
    score_value: 0,
    max_value: 10,
    notes: { some: "weak" },
  })
  const noNotes = stdbParamsToJson(
    { countryPackKey: "us", scoreKind: "price", scoreValue: 3.5, maxValue: 10, notes: null },
    "UpsertProposalProcurementScoreParams",
  )
  assert.deepEqual(noNotes.notes, { none: [] })
  assert.equal(noNotes.score_value, 3.5)
})
