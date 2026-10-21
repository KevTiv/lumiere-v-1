import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as queryState from "@lumiere/api-client"
import * as resourceReads from "@lumiere/stdb/resource-reads"

import { serverQueryUrl } from "./server-query-url"

describe("serverQueryUrl", () => {
  it("joins base and resource without double slashes", () => {
    assert.equal(
      serverQueryUrl("http://127.0.0.1:8082", "leads"),
      "http://127.0.0.1:8082/v1/query/leads",
    )
  })

  it("strips trailing slash from base", () => {
    assert.equal(
      serverQueryUrl("http://127.0.0.1:8082/", "sale-orders"),
      "http://127.0.0.1:8082/v1/query/sale-orders",
    )
  })

  it("encodes resource path segments", () => {
    assert.equal(
      serverQueryUrl("http://127.0.0.1:8082", "account-moves"),
      "http://127.0.0.1:8082/v1/query/account-moves",
    )
  })
})

function serverQueries(responses: Record<string, Response>) {
  const requests: Array<{ resource: string; headers: Headers }> = []
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@lumiere/api-client": queryState,
    "@lumiere/stdb/resource-reads": resourceReads,
    "@/lib/api-server-forward": { resolveApiServerBaseUrl: () => "http://api.test" },
    "@/lib/server-query-url": { serverQueryUrl },
  }
  const compiled = ts.transpileModule(readFileSync(new URL("./server-query.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as typeof import("./server-query") }
  runInNewContext(compiled, {
    module, exports: module.exports, Headers,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
    fetch: async (url: string, init: RequestInit) => {
      const resource = new URL(url).pathname.split("/").at(-1)!
      requests.push({ resource, headers: new Headers(init.headers) })
      assert.ok(responses[resource], `Unexpected resource ${resource}`)
      return responses[resource]!.clone()
    },
  })
  return { api: module.exports, requests }
}

const session = { stdbToken: "session-token", identityHex: "ab".repeat(32), organizationId: 1, opts: { token: "session-token" } } satisfies import("./api-session").ApiSession

describe("independent module prefetches", () => {
  it("keeps readable siblings and leaves denied resources unseeded", async () => {
    const { api, requests } = serverQueries({
      employees: Response.json({ data: [{ id: 1 }] }),
      departments: Response.json({ error: "Read permission denied" }, { status: 403 }),
      pricelists: Response.json({ data: [] }),
    })
    const seeds = await api.serverPrefetchQueryLists(session, ["employees", "departments", "pricelists"] as const)
    assert.deepEqual(Array.from(seeds), [[{ id: 1 }], undefined, []])
    assert.equal(requests.length, 3)
    for (const request of requests) {
      assert.equal(request.headers.get("authorization"), "Bearer session-token")
      assert.equal(request.headers.get("x-stdb-identity"), session.identityHex)
    }
    await assert.rejects(api.serverFetchQueryListsRequired(session, ["departments"]), /departments query denied/)
  })

  it("preserves operational failures instead of caching an empty result", async () => {
    const { api } = serverQueries({
      employees: Response.json({ error: "service unavailable" }, { status: 503 }),
    })
    await assert.rejects(api.serverPrefetchQueryLists(session, ["employees"]), /employees query unavailable/)
  })
})
