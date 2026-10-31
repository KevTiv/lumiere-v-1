import assert from "node:assert/strict"
import test from "node:test"

import { legacyRunRetirement } from "./retirement"

test("legacy BFF retirement returns a governed replacement without proxying", () => {
  assert.deepEqual(legacyRunRetirement(" report_analysis "), {
    error:
      "Skill 'report_analysis' has migrated from the legacy skill runner; use /api/ai/skills/report-analysis.",
    code: "legacy_skill_run_retired",
    skillKey: "report_analysis",
    replacementPath: "/api/ai/skills/report-analysis",
  })
})

test("legacy BFF retirement blocks uncertified custom skills", () => {
  const result = legacyRunRetirement("custom_skill")

  assert.equal(result.code, "legacy_skill_run_retired")
  assert.equal(result.skillKey, "custom_skill")
  assert.equal("replacementPath" in result, false)
  assert.match(result.error, /register and certify/)
})

test("legacy BFF retirement names the existing finance review routes", () => {
  for (const skill of [
    "finance_report_review",
    "bank_reconciliation_review",
    "period_close_review",
    "expense_evidence_review",
    "finance_variance_review",
  ]) {
    const result = legacyRunRetirement(` ${skill} `)

    assert.equal(result.code, "legacy_skill_run_retired")
    assert.equal(result.skillKey, skill)
    assert.equal(result.replacementPath, `/api/ai/skills/finance/${skill}`)
  }
})

test("legacy BFF retirement rejects inherited object keys as unknown skills", () => {
  for (const skill of ["constructor", "toString", "__proto__"]) {
    const result = legacyRunRetirement(skill)

    assert.equal(result.code, "legacy_skill_run_retired")
    assert.equal(result.skillKey, skill)
    assert.equal(Object.hasOwn(result, "replacementPath"), false)
    assert.match(result.error, /register and certify/)
  }
})
