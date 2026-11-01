import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { parseReadinessIntent, parseReportReadiness } from "../../../../../../lib/report-readiness"
function load(url: URL, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<any>> }
  runInNewContext(compiled, { module, exports: module.exports, JSON, String,
    require: (id: string) => { assert.ok(id in dependencies, `unexpected dependency: ${id}`); return dependencies[id] } })
  return module.exports
}
function fixture(options: { denied?: boolean; companyDenied?: boolean; actor?: string; upstreamStatus?: number; reply?: unknown } = {}) {
  const calls: { path: string; init: any }[] = []
  const server = load(new URL("../../../../../../lib/report-readiness-server.ts", import.meta.url), {
    "server-only": {}, "./report-readiness": { parseReportReadiness },
    "./ai-gateway-server": { fetchAiGateway: async (path: string, init: any) => {
      calls.push({ path, init }); const status = options.upstreamStatus ?? 200
      return { ok: status === 200, status, text: JSON.stringify("reply" in options ? options.reply : { companyId: 13, agentId: 7, billableCalls: 0, status: "blocked", code: "release_not_ready" }) }
    } },
  })
  const route = load(new URL("./route.ts", import.meta.url), {
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/report-readiness": { parseReadinessIntent }, "@/lib/report-readiness-server": server,
    "../../../_lib/route-helpers": {
      requireAiRouteContext: async () => options.denied ? { ok: false, response: Response.json({}, { status: 401 }) } :
        { ok: true, context: { orgId: 11, session: { identityHex: options.actor ?? "actor", stdbToken: "actor-token" } } },
      parseJsonBody: async (request: Request) => ({ ok: true, body: await request.json() }),
      validateCompanyScope: async () => options.companyDenied ? Response.json({}, { status: 403 }) : null,
    },
  })
  return { calls, submit: (body: unknown = { companyId: 13, agentId: 7 }) => route.POST(new Request("https://web.test/readiness", { method: "POST", body: JSON.stringify(body) })) }
}
test("stale release returns a no-cost typed blocker under server-owned actor scope", async () => {
  const f = fixture(); const response = await f.submit()
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal((await response.json()).code, "release_not_ready")
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, "/v1/internal/harness/report-readiness")
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { orgId: 11, companyId: 13, agentId: 7 })
  assert.equal(f.calls[0].init.headers["x-lumiere-actor-token"], "actor-token")
})
test("unauthorized, wrong company, forged scope and unknown actors do not inspect configuration", async () => {
  for (const options of [{ denied: true }, { companyDenied: true }, { actor: "unknown" }]) {
    const f = fixture(options); assert.ok((await f.submit()).status >= 400); assert.equal(f.calls.length, 0)
  }
  const f = fixture(); assert.equal((await f.submit({ companyId: 13, agentId: 7, orgId: 999 })).status, 400); assert.equal(f.calls.length, 0)
})
test("grant denial and invalid or foreign replies cannot enable analysis", async () => {
  const denied = fixture({ upstreamStatus: 403 }); assert.equal((await (await denied.submit()).json()).code, "authorization_denied")
  for (const reply of [null, {}, { companyId: 14, agentId: 7, billableCalls: 0, status: "ready", code: null }, { companyId: 13, agentId: 7, billableCalls: 1, status: "ready", code: null }]) {
    const f = fixture({ reply }); const result = await (await f.submit()).json(); assert.equal(result.status, "blocked"); assert.equal(result.code, "readiness_unavailable")
  }
  const unavailable = fixture({ upstreamStatus: 503, reply: { error: "private provider diagnostic" } })
  const text = await (await unavailable.submit()).text()
  assert.match(text, /readiness_unavailable/)
  assert.doesNotMatch(text, /private provider diagnostic/)
})
