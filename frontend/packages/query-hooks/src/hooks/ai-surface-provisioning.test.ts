import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { AiSurfaceProvisioningResult } from "./ai-skills"

type Mutation = {
  retry: boolean
  mutationFn(): Promise<AiSurfaceProvisioningResult>
  onSettled(): Promise<unknown>
}
const result: AiSurfaceProvisioningResult = {
  skills: [
    { skill_key: "rag_generation", skill_id: 7, status: "created" },
    { skill_key: "form_suggestion", skill_id: 8, status: "existing" },
    { skill_key: "action_draft_generation", skill_id: 9, status: "inactive" },
  ],
}

function fixture(response: unknown = result, status = 200) {
  const requests: { path: string; init: RequestInit }[] = []
  const invalidations: unknown[][] = []
  const dependencies: Record<string, unknown> = {
    "@lumiere/stdb/commands": {},
    "@tanstack/react-query": {
      useMutation: (options: Mutation) => options,
      useQueryClient: () => ({
        invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
          invalidations.push([...queryKey])
        },
      }),
    },
    "@lumiere/erp-shared/stdb-params-json": {},
    "@lumiere/api-client/response-error": {
      responseErrorMessage: async () => "Permission denied",
    },
    "../http": {
      apiFetch: async (path: string, init: RequestInit) => {
        requests.push({ path, init: JSON.parse(JSON.stringify(init)) })
        return Response.json(response, { status })
      },
    },
  }
  const compiled = ts.transpileModule(
    readFileSync(new URL("./ai-skills.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const module = {
    exports: {} as {
      useProvisionAiSurfaces(organizationId: number, companyId?: number): Mutation
      useSyncAiSkills(organizationId: number): Mutation
      parseAiSurfaceProvisioningResult(
        value: unknown,
      ): AiSurfaceProvisioningResult
    },
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`)
      return dependencies[id]
    },
  })
  return { hooks: module.exports, requests, invalidations }
}

test("setup uses the fixed session-scoped route and refreshes both skill catalogs", async () => {
  const f = fixture()
  const mutation = f.hooks.useProvisionAiSurfaces(7)
  assert.equal(mutation.retry, false)
  assert.deepEqual(
    JSON.parse(JSON.stringify(await mutation.mutationFn())),
    result,
  )
  assert.deepEqual(f.requests, [
    { path: "/api/ai/skills/provision-surfaces", init: { method: "POST" } },
  ])
  await mutation.onSettled()
  assert.deepEqual(f.invalidations, [["ai-skills-stdb", "7"], ["ai-skills"], ["stdb", "ai-agents", "7"]])
})

test("failed or incomplete setup is not reported as successful and saved rows still refresh", async () => {
  const denied = fixture({ error: "denied" }, 403)
  const mutation = denied.hooks.useProvisionAiSurfaces(7)
  await assert.rejects(mutation.mutationFn(), /Permission denied/)
  await mutation.onSettled()
  assert.deepEqual(denied.invalidations, [
    ["ai-skills-stdb", "7"],
    ["ai-skills"],
    ["stdb", "ai-agents", "7"],
  ])

  const f = fixture()
  for (const value of [
    null,
    {},
    { skills: [] },
    { skills: result.skills.slice(0, 2) },
    { skills: [result.skills[0], result.skills[0], result.skills[2]] },
    {
      skills: [
        result.skills[0],
        result.skills[1],
        { skill_key: "report_analysis", skill_id: 9, status: "created" },
      ],
    },
    {
      skills: [
        result.skills[0],
        result.skills[1],
        { ...result.skills[2], status: "ready" },
      ],
    },
    {
      skills: [
        result.skills[0],
        result.skills[1],
        { ...result.skills[2], skill_id: 0 },
      ],
    },
  ]) {
    assert.throws(
      () => f.hooks.parseAiSurfaceProvisioningResult(value),
      /could not be verified/,
    )
  }
  await assert.rejects(
    f.hooks.useProvisionAiSurfaces(0).mutationFn(),
    /organization is required/,
  )
  assert.equal(f.requests.length, 0)
})

test("existing full synchronization also refreshes the persisted registry", async () => {
  const f = fixture({ synced: ["rag_generation"], skills_dir: "/skills" })
  const mutation = f.hooks.useSyncAiSkills(7)
  await mutation.mutationFn()
  await mutation.onSettled()
  assert.deepEqual(f.invalidations, [["ai-skills-stdb", "7"], ["ai-skills"]])
})


test("company setup validates read-back scope and refreshes agent permissions", async () => {
  const configured = { ...result, company_setup: { company_id: 42, status: "bindings_applied", message: "Bindings only", stage: "company_defaults_checked", execution_readiness: "not_verified" } }
  const f = fixture(configured)
  const mutation = f.hooks.useProvisionAiSurfaces(7, 42)
  assert.deepEqual(JSON.parse(JSON.stringify(await mutation.mutationFn())), configured)
  assert.deepEqual(f.requests, [{ path: "/api/ai/skills/provision-surfaces", init: {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: 42 }),
  } }])
  await mutation.onSettled()
  assert.deepEqual(f.invalidations.at(-1), ["stdb", "ai-agents", "7"])
  for (const reply of [result, { ...configured, company_setup: { ...configured.company_setup, company_id: 43 } }]) {
    await assert.rejects(fixture(reply).hooks.useProvisionAiSurfaces(7, 42).mutationFn(), /could not be verified/)
  }
  for (const companyId of [0, -1, NaN, 1.5]) {
    const invalid = fixture(configured)
    await assert.rejects(invalid.hooks.useProvisionAiSurfaces(7, companyId).mutationFn(), /company is required/)
    assert.equal(invalid.requests.length, 0)
  }
})

test("profile-required is a distinct setup result, not a ready claim", async () => {
  const reply = { ...result, company_setup: { company_id: 42, status: "profile_required", message: "Profile required", stage: "platform_activation_required", execution_readiness: "not_verified" } }
  assert.equal((await fixture(reply).hooks.useProvisionAiSurfaces(7, 42).mutationFn()).company_setup?.status, "profile_required")
  for (const setup of [null, {}, { company_id: 42, status: "ready", message: "Ready" }, { company_id: 42, status: "configured" }]) {
    assert.throws(() => fixture().hooks.parseAiSurfaceProvisioningResult({ ...result, company_setup: setup }), /could not be verified/)
  }
})

test("missing platform defaults and preserved settings may return a partial catalog without claiming ready", async () => {
  for (const status of ["profile_required", "preserved"] as const) {
    const reply = { skills: [], company_setup: { company_id: 42, status, message: "Setup preserved", stage: "platform_activation_required", execution_readiness: "not_verified" } }
    assert.equal((await fixture(reply).hooks.useProvisionAiSurfaces(7, 42).mutationFn()).company_setup?.status, status)
  }
  assert.throws(() => fixture().hooks.parseAiSurfaceProvisioningResult({
    skills: [], company_setup: { company_id: 42, status: "configured", message: "Configured" },
  }), /could not be verified/)
})

test("binding evidence cannot be upgraded to execution readiness", () => {
  const setup = { company_id: 42, status: "bindings_applied", message: "Bindings only",
    stage: "platform_activation_required", execution_readiness: "not_verified" }
  const parser = fixture().hooks.parseAiSurfaceProvisioningResult
  assert.equal(parser({ ...result, company_setup: setup }).company_setup?.execution_readiness, "not_verified")
  for (const override of [
    { status: "configured" }, { execution_readiness: "ready" },
    { execution_readiness: undefined }, { stage: undefined },
  ]) {
    assert.throws(() => parser({ ...result, company_setup: { ...setup, ...override } }), /could not be verified/)
  }
})
