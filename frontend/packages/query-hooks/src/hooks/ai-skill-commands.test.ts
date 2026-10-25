import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as commands from "@lumiere/stdb/commands"
import * as paramsJson from "@lumiere/erp-shared/stdb-params-json"
import { toCreateAiSkillParams } from "@lumiere/erp-shared/ai-create-params"

type Mutation = { mutationFn(params: object): Promise<void> }

function mutation(file: string, hook: string, requests: { url: string; body: unknown }[]): Mutation {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as Record<string, (org: number) => Mutation> }
  const dependencies = {
    "@lumiere/stdb/commands": commands,
    "@tanstack/react-query": { useMutation: (options: Mutation) => options, useQueryClient: () => ({}) },
    "@lumiere/erp-shared/stdb-params-json": paramsJson,
    "@lumiere/api-client/response-error": {},
    "../http": { apiFetch: async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(null, { status: 200 })
    } },
  }
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name as keyof typeof dependencies]
  } })
  return module.exports[hook]!(1)
}

test("normal skill forms send all absent options explicitly without client organization authority", async () => {
  const requests: { url: string; body: unknown }[] = []
  const params = toCreateAiSkillParams({ skillKey: "report_analysis", name: "Report Analysis", promptTemplate: "Read the report" })
  assert.ok(params)
  for (const hook of ["useCreateAiSkill", "useUpsertAiSkill"]) {
    await mutation("./ai-skills.ts", hook, requests).mutationFn(params)
  }
  for (const request of requests) {
    const body = request.body as { params: Record<string, unknown>; organizationId?: unknown }
    assert.equal(body.organizationId, undefined)
    assert.equal(body.params.skill_key, "report_analysis")
    for (const field of ["description", "output_schema", "config_schema", "dataset_specs", "metadata"]) {
      assert.deepEqual(body.params[field], { none: [] }, field)
    }
  }
  assert.deepEqual(requests.map((r) => r.url), ["/api/operations/erp.create_ai_skill", "/api/operations/erp.upsert_ai_skill"])
})

test("version, fixture and assignment commands preserve supplied options and encode absent metadata", async () => {
  const requests: { url: string; body: unknown }[] = []
  await mutation("./ai-skill-registry.ts", "useCreateAiSkillVersion", requests).mutationFn({ skillId: 7n, manifestJson: "{}", reviewNotes: "Reviewed" })
  await mutation("./ai-skill-registry.ts", "useCreateAiSkillFixture", requests).mutationFn({ skillId: 7n, fixtureKey: "synthetic", name: "Synthetic", inputJson: "{}", expectedOutputJson: "{}" })
  await mutation("./ai-skills.ts", "useAssignTeamMemberSkill", requests).mutationFn({ teamMemberId: 8n, skillId: 7n, isDefault: true })
  const bodies = requests.map((r) => (r.body as { params: Record<string, unknown> }).params)
  assert.deepEqual(bodies[0]!.review_notes, { some: "Reviewed" })
  assert.deepEqual(bodies[0]!.metadata, { none: [] })
  assert.deepEqual(bodies[1]!.description, { none: [] })
  assert.deepEqual(bodies[1]!.metadata, { none: [] })
  assert.deepEqual(bodies[2]!.module_hint, { none: [] })
})
