import assert from "node:assert/strict"
import test from "node:test"

import { mapRagOutcomes, percent } from "./rag-outcomes"

const valid = {
  windowDays: 7,
  turns: 4,
  withheld: 1,
  withholdRate: 0.25,
  models: [{ provider: "anthropic", model: "m", turns: 4, withheld: 1, repaired: 1, withholdRate: 0.25 }],
  byReasonAndModel: [{ provider: "anthropic", model: "m", reason: "coverage_gap", withheld: 1, rate: 0.25 }],
  truncated: false,
}

test("maps a bounded closed-vocabulary report", () => {
  const view = mapRagOutcomes(valid)
  assert.equal(view?.byReasonAndModel[0]?.reason, "coverage_gap")
  assert.equal(percent(view?.withholdRate ?? 0), "25.0%")
})

test("rejects unknown reasons and malformed numbers", () => {
  assert.equal(mapRagOutcomes({ ...valid, byReasonAndModel: [{ ...valid.byReasonAndModel[0], reason: "free text" }] }), null)
  assert.equal(mapRagOutcomes({ ...valid, withholdRate: 2 }), null)
  assert.equal(mapRagOutcomes({ ...valid, models: "x" }), null)
  assert.equal(mapRagOutcomes(null), null)
})
