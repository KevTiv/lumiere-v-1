import assert from "node:assert/strict"
import { describe, it, beforeEach, afterEach } from "node:test"
import { NextRequest } from "next/server"

import { apiUrl } from "./api-url"
import {
  forwardToApiServerIfEnabled,
  resolveApiServerBaseUrl,
} from "./api-server-forward"

function setEnvVar(
  key: "LUMIERE_API_SERVER_URL" | "NODE_ENV" | "WORKOS_CLIENT_ID",
  value: string | undefined,
) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key)
    return
  }
  Object.defineProperty(process.env, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

describe("resolveApiServerBaseUrl", () => {
  const originalUrl = process.env.LUMIERE_API_SERVER_URL
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    setEnvVar("LUMIERE_API_SERVER_URL", undefined)
    setEnvVar("NODE_ENV", undefined)
  })

  afterEach(() => {
    setEnvVar("LUMIERE_API_SERVER_URL", originalUrl)
    setEnvVar("NODE_ENV", originalNodeEnv)
  })

  it("returns null when forwarding is explicitly disabled", () => {
    process.env.LUMIERE_API_SERVER_URL = "off"
    assert.equal(resolveApiServerBaseUrl(), null)
  })

  it("returns trimmed base URL without trailing slash", () => {
    process.env.LUMIERE_API_SERVER_URL = "http://127.0.0.1:8082/"
    assert.equal(resolveApiServerBaseUrl(), "http://127.0.0.1:8082")
  })

  it("defaults to local api-server in development", () => {
    setEnvVar("NODE_ENV", "development")
    assert.equal(resolveApiServerBaseUrl(), "http://127.0.0.1:8082")
  })

  it("returns null in production when unset", () => {
    setEnvVar("NODE_ENV", "production")
    assert.equal(resolveApiServerBaseUrl(), null)
  })
})

it("forwards the expected organization only on typed operation posts", async (context) => {
  const originalUrl = process.env.LUMIERE_API_SERVER_URL
  const originalWorkOs = process.env.WORKOS_CLIENT_ID
  context.after(() => {
    setEnvVar("LUMIERE_API_SERVER_URL", originalUrl)
    setEnvVar("WORKOS_CLIENT_ID", originalWorkOs)
  })
  setEnvVar("LUMIERE_API_SERVER_URL", "https://api.example.test")
  setEnvVar("WORKOS_CLIENT_ID", undefined)
  const observed: Array<{
    url: string
    organization: string | null
    company: string | null
  }> = []
  context.mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      observed.push({
        url,
        organization: headers.get("x-lumiere-organization-id"),
        company: headers.get("x-lumiere-company-id"),
      })
      return Response.json({ ok: true })
    },
  )

  const requestHeaders = {
    "x-lumiere-organization-id": "7",
    "x-lumiere-company-id": "11",
  }
  const operationPath = "/api/operations/erp.complete_activity"
  for (const [path, method] of [
    [operationPath, "POST"],
    [operationPath, "GET"],
    ["/api/query/activities", "POST"],
  ]) {
    await forwardToApiServerIfEnabled(
      new NextRequest(`https://app.example.test${path}`, {
        method,
        headers: requestHeaders,
      }),
    )
  }
  assert.deepEqual(observed, [
    {
      url: "https://api.example.test/v1/operations/erp.complete_activity",
      organization: "7",
      company: null,
    },
    {
      url: "https://api.example.test/v1/operations/erp.complete_activity",
      organization: null,
      company: null,
    },
    {
      url: "https://api.example.test/v1/query/activities",
      organization: null,
      company: null,
    },
  ])
})

describe("authoritative draft readback gateway URL", () => {
  const directGateway = process.env.NEXT_PUBLIC_API_GATEWAY_URL
  afterEach(() => {
    if (directGateway === undefined)
      delete process.env.NEXT_PUBLIC_API_GATEWAY_URL
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = directGateway
  })

  it("preserves the registered exact-resource path through direct Rust gateway mode", () => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = "https://api.example.test/"
    assert.equal(
      apiUrl("/api/authoritative/ai-action-drafts/41?companyId=3"),
      "https://api.example.test/v1/authoritative/ai-action-drafts/41?companyId=3",
    )
    assert.equal(apiUrl("/api/ai/rag"), "/api/ai/rag")
  })

  it("keeps exact readback same-origin when the web BFF owns forwarding", () => {
    delete process.env.NEXT_PUBLIC_API_GATEWAY_URL
    assert.equal(
      apiUrl("/api/authoritative/ai-action-drafts/41?companyId=3"),
      "/api/authoritative/ai-action-drafts/41?companyId=3",
    )
  })
})
