import assert from "node:assert/strict"
import test from "node:test"

import {
  LegacyAiSkillRunRetiredError,
  legacyAiSkillRunRetirement,
} from "./ai-skills"

test("legacy hook contract names the governed BFF replacement", () => {
  const retirement = legacyAiSkillRunRetirement(" low_stock ")

  assert.deepEqual(retirement, {
    code: "legacy_skill_run_retired",
    skill_key: "low_stock",
    replacement_path: "/api/ai/inventory/low-stock",
    error:
      "Skill 'low_stock' no longer runs through the legacy skill hook; use /api/ai/inventory/low-stock.",
  })
  assert.match(new LegacyAiSkillRunRetiredError(retirement).message, /inventory\/low-stock/)
})

test("custom skills require a certified governed adapter", () => {
  const retirement = legacyAiSkillRunRetirement("custom_skill")

  assert.equal(retirement.code, "legacy_skill_run_retired")
  assert.equal(retirement.skill_key, "custom_skill")
  assert.equal(retirement.replacement_path, undefined)
  assert.match(retirement.error, /register and certify/)
})
