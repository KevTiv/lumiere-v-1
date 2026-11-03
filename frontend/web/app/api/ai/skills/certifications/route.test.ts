import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function fixture(authenticated: boolean, status = 200) {
  const calls: string[] = []
  const compiled = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as Record<string, (request: unknown) => Promise<Response>> }
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: Object.assign(Response, { json: Response.json.bind(Response) }) },
    "@/lib/api-server-forward": { forwardToApiServerRequired: async () => { calls.push("api-server"); return Response.json({ data: [] }) } },
    "@/lib/ai-gateway-server": { fetchAiGateway: async (path: string) => { calls.push(path); return { status, text: JSON.stringify({ bindings: [] }) } } },
    "../../_lib/route-helpers": { requireAiRouteContext: async () => authenticated
      ? { ok: true, context: { orgId: 7 } }
      : { ok: false, response: Response.json({}, { status: 401 }) } },
  }
  runInNewContext(compiled, { module, exports: module.exports, require: (id: string) => {
    assert.ok(id in dependencies, `unexpected dependency: ${id}`)
    return dependencies[id]
  } })
  return { route: module.exports, calls }
}

const request = (view = "") => ({ nextUrl: new URL(`http://localhost/api/ai/skills/certifications${view ? `?view=${view}` : ""}`) })

test("native discovery requires an authenticated organization session", async () => {
  const { route, calls } = fixture(false)
  assert.equal((await route.GET!(request("native-bindings"))).status, 401)
  assert.deepEqual(calls, [])
})

test("native discovery uses a fixed read-only gateway path with no caching", async () => {
  const { route, calls } = fixture(true)
  const response = await route.GET!(request("native-bindings"))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(calls, ["/v1/internal/harness/skill-bindings"])
})

test("runtime failure is propagated and ordinary certification keeps its existing boundary", async () => {
  const { route, calls } = fixture(true, 503)
  assert.equal((await route.GET!(request("native-bindings"))).status, 503)
  await route.GET!(request())
  await route.POST!(request())
  assert.deepEqual(calls, ["/v1/internal/harness/skill-bindings", "api-server", "api-server"])
})
