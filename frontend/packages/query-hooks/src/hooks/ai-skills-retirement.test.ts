import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

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

test("finance reviews name their existing governed BFF replacements", () => {
  for (const skill of [
    "finance_report_review",
    "bank_reconciliation_review",
    "period_close_review",
    "expense_evidence_review",
    "finance_variance_review",
  ]) {
    const retirement = legacyAiSkillRunRetirement(` ${skill} `)

    assert.equal(retirement.code, "legacy_skill_run_retired")
    assert.equal(retirement.skill_key, skill)
    assert.equal(retirement.replacement_path, `/api/ai/skills/finance/${skill}`)
    assert.match(retirement.error, /no longer runs through the legacy skill hook/)
  }
})

test("inherited object keys are not governed skills", () => {
  for (const skill of ["constructor", "toString", "__proto__"]) {
    const retirement = legacyAiSkillRunRetirement(skill)

    assert.equal(retirement.code, "legacy_skill_run_retired")
    assert.equal(retirement.skill_key, skill)
    assert.equal(Object.hasOwn(retirement, "replacement_path"), false)
    assert.match(retirement.error, /register and certify/)
  }
})

test("the retired mutation rejects finance and unknown skills without HTTP dispatch", async () => {
  type Mutation = { mutationFn(params: { companyId: number; skillKey: string }): Promise<never> }
  const requests: string[] = []
  const compiled = ts.transpileModule(readFileSync(new URL("./ai-skills.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { useRunAiSkill(): Mutation } }
  const dependencies = {
    "@lumiere/stdb/commands": {},
    "@tanstack/react-query": { useMutation: (options: Mutation) => options },
    "@lumiere/erp-shared/stdb-params-json": {},
    "@lumiere/api-client/response-error": {},
    "../http": { apiFetch: async (url: string) => { requests.push(url); return new Response() } },
  }
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`)
    return dependencies[name as keyof typeof dependencies]
  } })
  const mutation = module.exports.useRunAiSkill()

  for (const skillKey of [
    "finance_report_review", "bank_reconciliation_review", "period_close_review",
    "expense_evidence_review", "finance_variance_review", "custom_skill",
    "constructor", "toString", "__proto__",
  ]) {
    await assert.rejects(mutation.mutationFn({ companyId: 2, skillKey }), {
      name: "LegacyAiSkillRunRetiredError",
      message: legacyAiSkillRunRetirement(skillKey).error,
    })
  }
  assert.deepEqual(requests, [])
})
