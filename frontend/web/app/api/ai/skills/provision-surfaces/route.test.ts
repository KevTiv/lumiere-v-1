import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { FieldAccessContext } from "@lumiere/stdb/server"
import { sessionAllowsPermission } from "../../../../../lib/session-permissions"

const actor = "a".repeat(64)
function fixture(
  options: {
    authenticated?: boolean
    token?: string
    access?: Partial<FieldAccessContext>
    upstreamStatus?: number
    companyAllowed?: boolean
  } = {},
) {
  const calls: { path: string; payload: unknown }[] = []
  const session = {
    identityHex: actor,
    organizationId: 7,
    stdbToken: options.token ?? "actor-token",
    fieldAccess: {
      identityHex: actor,
      organizationId: 7,
      roleId: 2,
      roleName: "skill-admin",
      isSuperuser: false,
      rolePermissions: ["ai_skill:create"],
      fieldPermissions: [],
      ...options.access,
    },
  }
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/session-permissions": { sessionAllowsPermission },
    "../../_lib/route-helpers": {
      parseJsonBody: async (request: Request) => ({ ok: true, body: await request.json() }),
      validateCompanyScope: async (_session: unknown, companyId: number) =>
        companyId === 42 && options.companyAllowed !== false
          ? null
          : Response.json({ error: "Company does not belong to this organization" }, { status: 403 }),
      requireAiRouteContext: async () =>
        options.authenticated === false
          ? {
              ok: false,
              response: Response.json(
                { error: "Unauthorized" },
                { status: 401 },
              ),
            }
          : { ok: true, context: { orgId: 7, session } },
      proxyAiGateway: async (path: string, payload: unknown) => {
        calls.push({ path, payload: JSON.parse(JSON.stringify(payload)) })
        return Response.json(
          { skills: [] },
          { status: options.upstreamStatus ?? 200 },
        )
      },
    },
  }
  const compiled = ts.transpileModule(
    readFileSync(new URL("./route.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const module = {
    exports: {} as { POST(request: Request): Promise<Response> },
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`)
      return dependencies[id]
    },
  })
  return {
    calls,
    submit: (body?: unknown) =>
      module.exports.POST(
        new Request("https://web.test/api/ai/skills/provision-surfaces", {
          method: "POST",
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      ),
  }
}

test("feature setup derives all scope and authority from the verified session", async () => {
  const f = fixture()
  assert.equal(
    (
      await f.submit({
        org_id: 999,
        stdb_token: "forged",
        skill_keys: ["report_analysis"],
      })
    ).status,
    200,
  )
  assert.deepEqual(f.calls, [
    {
      path: "/v1/skills/provision-surfaces",
      payload: { org_id: 7, stdb_token: "actor-token" },
    },
  ])
})

test("unauthenticated, tokenless and unauthorized users cannot run setup, even as a no-op", async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401],
    [{ token: "" }, 401],
    [{ token: "   " }, 401],
    [{ access: { rolePermissions: ["ai_skill:read"] } }, 403],
    [{ access: { organizationId: 8 } }, 403],
    [{ access: { identityHex: "b".repeat(64) } }, 403],
    [
      {
        access: {
          rolePermissions: ["*:*"],
          orgPermissions: [
            { resource: "ai_skill", action: "create", allow: false },
          ],
        },
      },
      403,
    ],
  ] as const) {
    const f = fixture(options)
    assert.equal((await f.submit()).status, status)
    assert.equal(f.calls.length, 0)
  }
})

test("gateway rejection is returned without retrying or selecting a different credential", async () => {
  for (const status of [403, 503]) {
    const f = fixture({ upstreamStatus: status })
    assert.equal((await f.submit()).status, status)
    assert.equal(f.calls.length, 1)
  }
})

test("company setup forwards only validated scope, never client agent or policy choices", async () => {
  const f = fixture()
  assert.equal((await f.submit({ companyId: 42, agentId: 999, intelligencePolicyRef: "forged" })).status, 200)
  assert.deepEqual(f.calls, [{
    path: "/v1/skills/provision-surfaces",
    payload: { org_id: 7, stdb_token: "actor-token", company_id: 42 },
  }])
  for (const companyId of [0, -1, 1.5, "42", null, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = fixture()
    assert.equal((await invalid.submit({ companyId })).status, 400)
    assert.equal(invalid.calls.length, 0)
  }
  const denied = fixture({ companyAllowed: false })
  assert.equal((await denied.submit({ companyId: 42 })).status, 403)
  assert.equal(denied.calls.length, 0)
})
