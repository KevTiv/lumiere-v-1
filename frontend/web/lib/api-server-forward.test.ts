import assert from "node:assert/strict"
import { describe, it, beforeEach, afterEach } from "node:test"

import { resolveApiServerBaseUrl } from "../lib/api-server-forward"

function setEnvVar(key: "LUMIERE_API_SERVER_URL" | "NODE_ENV", value: string | undefined) {
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
