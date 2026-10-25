import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import * as http from "../http"

type Query = { queryKey: readonly unknown[]; enabled: boolean; queryFn(): Promise<unknown> }
function skillQuery(organizationId: number): Query {
  const compiled = ts.transpileModule(readFileSync(new URL("./ai-skills.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { useRegisteredAiSkills(org: number): Query } }
  const dependencies = {
    "@lumiere/stdb/commands": {},
    "@tanstack/react-query": { useQuery: (options: Query) => options },
    "@lumiere/erp-shared/stdb-params-json": {},
    "@lumiere/api-client/response-error": {},
    "../http": http,
  }
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name as keyof typeof dependencies]
  } })
  return module.exports.useRegisteredAiSkills(organizationId)
}

const row = { id: 7, organizationId: 1, skillKey: "report_analysis", name: "Report Analysis", category: "analytics", description: "Registered pilot", isSystem: false }

test("skill administration reads canonical registered rows without the runtime catalog", async () => {
  const requests: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    return new Response(JSON.stringify({ data: [row] }))
  }
  const client = createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" })
  registerLumiereApiClient(client)
  try {
    const query = skillQuery(1)
    assert.equal(JSON.stringify(query.queryKey), JSON.stringify(["ai-skills-stdb", "1"]))
    assert.equal(query.enabled, true)
    const result = await query.queryFn()
    assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ id: 7, skill_key: "report_analysis", name: "Report Analysis", category: "analytics", description: "Registered pilot", is_system: false, source: "stdb", legacy_run_supported: false }])
    assert.deepEqual(requests, ["http://api.test/api/query/ai-skills"])
    assert.notDeepEqual(query.queryKey, skillQuery(2).queryKey)
  } finally { globalThis.fetch = realFetch; registerLumiereApiClient(null) }
})

test("masked or denied skill reads fail without a gateway fallback", async () => {
  const realFetch = globalThis.fetch
  const requests: string[] = []
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" }))
  try {
    for (const [status, payload] of [[200, { data: [{ id: 7, organizationId: 1 }] }], [403, { error: "denied" }]] as const) {
      globalThis.fetch = async (input) => { requests.push(String(input)); return new Response(JSON.stringify(payload), { status }) }
      await assert.rejects(skillQuery(1).queryFn())
    }
    assert.deepEqual(requests, ["http://api.test/api/query/ai-skills", "http://api.test/api/query/ai-skills"])
    assert.equal(skillQuery(0).enabled, false)
    await assert.rejects(skillQuery(0).queryFn(), /organization is required/)
    assert.equal(requests.length, 2)
  } finally { globalThis.fetch = realFetch; registerLumiereApiClient(null) }
})
