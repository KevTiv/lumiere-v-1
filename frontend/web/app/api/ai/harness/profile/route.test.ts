import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { canManagePlatformAiProfile } from "../../../../../lib/platform-ai-authority"
import { parsePlatformAiProfile } from "../../../../../lib/ai-platform-profile"

const actor = "a".repeat(64)
function fixture(superuser = true, foreignIdentity = false) {
  const calls: unknown[] = []
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/platform-ai-authority": { canManagePlatformAiProfile },
    "@/lib/ai-platform-profile": { parsePlatformAiProfile },
    "../../_lib/route-helpers": {
      requireAiRouteContext: async () => ({ ok: true, context: { orgId: 7, session: {
        organizationId: 7, identityHex: actor, stdbToken: "actor-token",
        fieldAccess: { organizationId: 7, identityHex: foreignIdentity ? "b".repeat(64) : actor, isSuperuser: superuser },
      } } }),
      parseJsonBody: async (request: Request) => {
        try { return { ok: true, body: await request.json() } }
        catch { return { ok: false, response: Response.json({ error: "Invalid JSON" }, { status: 400 }) } }
      },
      proxyAiGateway: async (path: string, payload: unknown) => {
        calls.push(JSON.parse(JSON.stringify({ path, payload })))
        return Response.json({ active_template: null, templates: [] })
      },
    },
  }
  const compiled = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { GET(request: Request): Promise<Response>; POST(request: Request): Promise<Response> } }
  runInNewContext(compiled, { module, exports: module.exports, require: (id: string) => { assert.ok(id in dependencies); return dependencies[id] } })
  return { calls, get: () => module.exports.GET(new Request("https://web.test/api/ai/harness/profile")),
    post: (body: unknown) => module.exports.POST(new Request("https://web.test/api/ai/harness/profile", { method: "POST", body: JSON.stringify(body) })) }
}

test("central profile read is platform-superuser only and credentials remain in server POST body", async () => {
  for (const f of [fixture(false), fixture(true, true)]) {
    assert.equal((await f.get()).status, 403)
    assert.equal((await f.post({})).status, 403)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.equal((await f.get()).status, 200)
  assert.deepEqual(f.calls, [{ path: "/v1/harness/platform-profile", payload: { org_id: 7, stdb_token: "actor-token" } }])
})

test("central profile writes validate input before dispatch", async () => {
  const f = fixture()
  assert.equal((await f.post({ org_id: 999, stdb_token: "forged" })).status, 400)
  assert.equal(f.calls.length, 0)
})

test("central publication forwards only validated settings with session authority", async () => {
  const model = { provider: "mistral", model: "generation-v1", max_tokens: 2048, context_window: 32000, timeout_ms: 30000, max_concurrency: 2, input_cost_per_1k_microunits: 0, output_cost_per_1k_microunits: 10 }
  const profile = { template_key: "alpha-default", template_version: 1, generation_profile: model, review_profile: { ...model, model: "review-v1" }, currency: "USD", monthly_limit_units: 5000000, rate_limit_per_minute: 10, max_enrolled_organizations: 5 }
  const f = fixture()
  assert.equal((await f.post({ ...profile, org_id: 999, skill_ids: [999], stdb_token: "forged" })).status, 200)
  assert.deepEqual(f.calls, [{ path: "/v1/harness/platform-profile", payload: { org_id: 7, stdb_token: "actor-token", profile } }])
})
