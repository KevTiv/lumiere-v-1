import assert from "node:assert/strict"
import test from "node:test"

import nextConfig from "./next.config.mjs"

test("private ERP responses discourage indexing without caching private data", async () => {
  assert.ok(nextConfig.headers)
  const headers = await nextConfig.headers()
  assert.deepEqual(headers, [{
    source: '/:path*',
    headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
  }])
})

test('API routes always use the runtime BFF, including builds without WorkOS configuration', async () => {
  const previousClient = process.env.WORKOS_CLIENT_ID
  const previousApi = process.env.LUMIERE_API_SERVER_URL
  try {
    process.env.LUMIERE_API_SERVER_URL = 'http://api.internal'
    for (const clientId of [undefined, 'client_test']) {
      if (clientId === undefined) delete process.env.WORKOS_CLIENT_ID
      else process.env.WORKOS_CLIENT_ID = clientId
      const result = await nextConfig.rewrites!()
      const rewrites = Array.isArray(result) ? result : result.afterFiles ?? []
      assert.equal(rewrites.some((entry) => entry.source.startsWith('/api/')), false)
    }
  } finally {
    if (previousClient === undefined) delete process.env.WORKOS_CLIENT_ID
    else process.env.WORKOS_CLIENT_ID = previousClient
    if (previousApi === undefined) delete process.env.LUMIERE_API_SERVER_URL
    else process.env.LUMIERE_API_SERVER_URL = previousApi
  }
})
