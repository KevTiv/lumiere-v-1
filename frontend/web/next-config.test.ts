import assert from "node:assert/strict"
import test from "node:test"

import nextConfig from "./next.config.mjs"

test("Next forwards typed operation paths to api-server", async () => {
  const previous = process.env.LUMIERE_API_SERVER_URL
  process.env.LUMIERE_API_SERVER_URL = "http://127.0.0.1:8082/"
  try {
    assert.ok(nextConfig.rewrites)
    const result = await nextConfig.rewrites()
    const rewrites = Array.isArray(result) ? result : result.afterFiles ?? []
    assert.deepEqual(
      rewrites.find((rewrite) => rewrite.source === "/api/operations/:path*"),
      {
        source: "/api/operations/:path*",
        destination: "http://127.0.0.1:8082/v1/operations/:path*",
      },
    )
  } finally {
    if (previous === undefined) delete process.env.LUMIERE_API_SERVER_URL
    else process.env.LUMIERE_API_SERVER_URL = previous
  }
})

test("Next forwards the explicit reducer compatibility path to api-server", async () => {
  const previous = process.env.LUMIERE_API_SERVER_URL
  process.env.LUMIERE_API_SERVER_URL = "http://127.0.0.1:8082/"
  try {
    assert.ok(nextConfig.rewrites)
    const result = await nextConfig.rewrites()
    const rewrites = Array.isArray(result) ? result : result.afterFiles ?? []
    assert.deepEqual(
      rewrites.find((rewrite) => rewrite.source === "/api/compat/reducer/:path*"),
      {
        source: "/api/compat/reducer/:path*",
        destination: "http://127.0.0.1:8082/v1/compat/reducer/:path*",
      },
    )
    assert.equal(
      rewrites.some((rewrite) => rewrite.source === "/api/call/:path*"),
      false,
    )
  } finally {
    if (previous === undefined) delete process.env.LUMIERE_API_SERVER_URL
    else process.env.LUMIERE_API_SERVER_URL = previous
  }
})
