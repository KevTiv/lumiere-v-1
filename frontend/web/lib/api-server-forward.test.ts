import assert from "node:assert/strict"
import { describe, it, beforeEach, afterEach } from "node:test"

import { resolveApiServerBaseUrl } from "../lib/api-server-forward.ts"

describe("resolveApiServerBaseUrl", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.LUMIERE_API_SERVER_URL
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = { ...originalEnv }
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
    process.env.NODE_ENV = "development"
    assert.equal(resolveApiServerBaseUrl(), "http://127.0.0.1:8082")
  })

  it("returns null in production when unset", () => {
    process.env.NODE_ENV = "production"
    assert.equal(resolveApiServerBaseUrl(), null)
  })
})
