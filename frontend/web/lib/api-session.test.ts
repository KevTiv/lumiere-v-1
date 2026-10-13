import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { ApiSession } from "./api-session"

// Run the real resolver with isolated request/server dependencies, without a Next server.
const source = readFileSync(new URL("./api-session.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const verifiedIdentity = (token: string) => (token === "approver" ? "b" : "a").repeat(64)

function resolver(options: {
  cookies?: Record<string, string>
  production?: boolean
  mock?: boolean
  rejectedToken?: string
  unavailable?: boolean
  response?: unknown
} = {}) {
  const fieldTokens: string[] = []
  const jar = options.cookies ?? {}
  const module = { exports: {} as { resolveApiSession: (req?: Request) => Promise<ApiSession | null> } }
  const dependencies: Record<string, unknown> = {
    "next/headers": {
      cookies: async () => ({
        get: (name: string) => name in jar ? { value: jar[name] } : undefined,
        getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      }),
    },
    "@/lib/api-server-forward": { resolveApiServerBaseUrl: () => "http://api.test" },
    "@/lib/stdb-reducer": {
      callReducer: () => { throw new Error("session resolution must not provision a caller") },
    },
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: string) => {
      assert.ok(id in dependencies, `unexpected runtime dependency: ${id}`)
      return dependencies[id]
    },
    process: { env: {
      NODE_ENV: options.production ? "production" : "development",
      ...(options.mock === false ? {} : { DEV_MOCK_ORG_ID: "1", STDB_SERVER_TOKEN: "owner" }),
    } },
    Headers,
    fetch: async (_url: string, init: { headers: HeadersInit }) => {
      const authorization = new Headers(init.headers).get("authorization")!
      fieldTokens.push(authorization)
      if (options.unavailable) throw new Error("API unavailable")
      const token = authorization.slice(7)
      return {
        ok: token !== options.rejectedToken,
        json: async () => options.response ?? {
          identityHex: verifiedIdentity(token),
          organizationId: token === "owner" ? 1 : 42,
          fieldAccess: { roles: [] },
        },
      }
    },
  })
  return { resolve: module.exports.resolveApiSession, fieldTokens }
}

test("explicit bearer wins over both browser cookies and the development owner", async () => {
  const { resolve, fieldTokens } = resolver({ cookies: { stdb_token: "cookie" } })
  const session = await resolve(new Request("http://web.test", {
    headers: { authorization: "Bearer reader" },
  }))
  assert.ok(session)
  assert.equal(session.stdbToken, "reader")
  assert.equal(session.identityHex, verifiedIdentity("reader"))
  assert.equal(session.organizationId, 42)
  assert.deepEqual(fieldTokens, ["Bearer reader"])
})

test("browser cookie preserves the second-person actor with mock mode enabled", async () => {
  const { resolve, fieldTokens } = resolver({
    cookies: { stdb_token: "approver", stdb_identity: "approver-identity" },
  })
  const session = await resolve()
  assert.ok(session)
  assert.equal(session.stdbToken, "approver")
  assert.equal(session.identityHex, verifiedIdentity("approver"))
  assert.equal(session.organizationId, 42)
  assert.deepEqual(fieldTokens, ["Bearer approver"])
})

test("malformed or empty explicit credentials never downgrade to cookies or the mock owner", async () => {
  for (const authorization of ["", "Basic bad", "Bearer "]) {
    const { resolve, fieldTokens } = resolver({ cookies: { stdb_token: "cookie" } })
    assert.equal(await resolve(new Request("http://web.test", { headers: { authorization } })), null)
    assert.deepEqual(fieldTokens, [])
  }
  const { resolve, fieldTokens } = resolver({ cookies: { stdb_token: "" } })
  assert.equal(await resolve(), null)
  assert.deepEqual(fieldTokens, [])
})

test("anonymous development can still use the configured mock", async () => {
  const { resolve, fieldTokens } = resolver()
  const session = await resolve()
  assert.ok(session)
  assert.equal(session.stdbToken, "owner")
  assert.equal(session.organizationId, 1)
  assert.deepEqual(fieldTokens, ["Bearer owner"])
})

test("anonymous requests remain unauthenticated in production or without a mock", async () => {
  assert.equal(await resolver({ production: true }).resolve(), null)
  assert.equal(await resolver({ mock: false }).resolve(), null)
})

test("a rejected bearer plus forged identity cannot inherit the owner's membership", async () => {
  const { resolve, fieldTokens } = resolver({ rejectedToken: "garbage", cookies: { stdb_token: "owner" } })
  assert.equal(await resolve(new Request("http://web.test", {
    headers: { authorization: "Bearer garbage", "x-stdb-identity": "f".repeat(64) },
  })), null)
  assert.deepEqual(fieldTokens, ["Bearer garbage"])
})

test("API unavailability or incomplete authoritative identity fails closed", async () => {
  const request = new Request("http://web.test", { headers: { authorization: "Bearer reader" } })
  assert.equal(await resolver({ unavailable: true }).resolve(request), null)
  assert.equal(await resolver({ response: { organizationId: 1, fieldAccess: {} } }).resolve(request), null)
  assert.equal(await resolver({ response: { identityHex: verifiedIdentity("reader"), organizationId: "1" } }).resolve(request), null)
})
