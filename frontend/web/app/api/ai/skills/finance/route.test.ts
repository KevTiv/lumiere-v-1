import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { buildTrustedGovernedLlmRequest } from "../_governed-llm-contract"

const compiled = ts.transpileModule(
  readFileSync(new URL("./[skill]/route.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText

function financeRoute(
  options: {
    refreshFails?: boolean
    denied?: boolean
    companyDenied?: boolean
    actor?: string
    skill?: string
    body?: Record<string, unknown>
  } = {},
) {
  const calls: string[] = []
  const refreshes: { name: string; args: unknown[]; token: string }[] = []
  const forwarded: { body: unknown; headers: unknown }[] = []
  const session = {
    identityHex: options.actor ?? "a".repeat(64),
    stdbToken: "actor-token",
    opts: { token: "actor-token" },
    fieldAccess: {},
  }
  const dependencies: Record<string, unknown> = {
    "next/server": {
      NextResponse: {
        json: (body: unknown, init: ResponseInit) => Response.json(body, init),
      },
    },
    "../../../_lib/route-helpers": {
      requireAiRouteContext: async () =>
        options.denied
          ? {
              ok: false,
              response: Response.json(
                { error: "Unauthorized" },
                { status: 401 },
              ),
            }
          : { ok: true, context: { session, orgId: 11 } },
      parseJsonBody: async (request: Request) => ({
        ok: true,
        body: await request.json(),
      }),
      positiveInteger: (value: unknown) =>
        typeof value === "number" && value > 0 ? value : NaN,
      optionalPositiveInteger: (value: unknown) => value,
      sanitizeRecord: (value: unknown) => value,
      validateCompanyScope: async () =>
        options.companyDenied
          ? Response.json({ error: "Forbidden" }, { status: 403 })
          : null,
      proxyAiGateway: async (
        _path: string,
        body: unknown,
        headers: unknown,
      ) => {
        calls.push("gateway")
        forwarded.push({ body, headers })
        return Response.json({ summary: "complete" })
      },
    },
    "../../../_lib/ai-privacy-policy": {
      resolveAiPrivacyPolicy: () => ({
        allowedFields: [],
        maskedFields: [],
        suppressedFields: [],
        maskPhoneFields: true,
        maskPaymentReferences: true,
        suppressSecrets: true,
      }),
    },
    "../../_governed-llm-contract": { buildTrustedGovernedLlmRequest },
    "@/lib/stdb-reducer": {
      callReducer: async (
        name: string,
        args: unknown[],
        opts: { token: string },
      ) => {
        calls.push("refresh")
        refreshes.push({ name, args: [...args], token: opts.token })
        if (options.refreshFails) throw new Error("private upstream failure")
      },
    },
  }
  const module = {
    exports: {} as {
      POST: (
        request: Request,
        context: { params: Promise<{ skill: string }> },
      ) => Promise<Response>
    },
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => {
      assert.ok(id in dependencies, `unexpected runtime dependency: ${id}`)
      return dependencies[id]
    },
  })
  const request = () =>
    new Request("https://web.test/api/ai/skills/finance/period_close_review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: 13,
        agentId: 7,
        inputs: { periodId: 42 },
        orgId: 999,
        stdbToken: "forged-token",
        identityHex: "f".repeat(64),
        ...options.body,
      }),
    })
  return {
    submit: () =>
      module.exports.POST(request(), {
        params: Promise.resolve({
          skill: options.skill ?? "period_close_review",
        }),
      }),
    calls,
    refreshes,
    forwarded,
  }
}

test("finance admission refreshes the current caller snapshot before contacting the gateway", async () => {
  const route = financeRoute()
  assert.equal((await route.submit()).status, 200)
  assert.deepEqual(route.calls, ["refresh", "gateway"])
  assert.deepEqual(route.refreshes, [
    { name: "refresh_policy_snapshot", args: [11], token: "actor-token" },
  ])
  assert.deepEqual(route.forwarded[0].headers, {
    "x-lumiere-organization-id": "11",
    "x-lumiere-company-id": "13",
    "x-lumiere-actor-identity": "a".repeat(64),
    "x-lumiere-actor-token": "actor-token",
  })
})

test("unknown workflows and imprecise identities cannot refresh or execute", async () => {
  const unknown = financeRoute({ skill: "../unrestricted" })
  assert.equal((await unknown.submit()).status, 404)
  assert.deepEqual(unknown.calls, [])
  for (const body of [
    { companyId: 9007199254740993 },
    { agentId: -1 },
    { resumeRunId: 9007199254740993 },
    { inputs: { periodId: 9007199254740993 } },
  ]) {
    const route = financeRoute({ body })
    assert.equal((await route.submit()).status, 400)
    assert.deepEqual(route.calls, [])
  }
})

test("a failed snapshot refresh does not start a finance review or expose the upstream error", async () => {
  const route = financeRoute({ refreshFails: true })
  const response = await route.submit()
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: "Authorization refresh unavailable. No review was started.",
  })
  assert.deepEqual(route.calls, ["refresh"])
  assert.equal(route.forwarded.length, 0)
})

test("unauthorized callers and wrong-company requests cannot refresh policy or start a finance review", async () => {
  for (const options of [
    { denied: true },
    { companyDenied: true },
    { actor: "unknown" },
  ]) {
    const route = financeRoute(options)
    assert.ok((await route.submit()).status >= 400)
    assert.deepEqual(route.calls, [])
  }
})
