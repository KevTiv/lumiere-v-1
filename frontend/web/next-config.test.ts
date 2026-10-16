import assert from "node:assert/strict"
import test from "node:test"
import type { NextConfig } from "next"

import nextConfig from "./next.config.mjs"

test("webpack preserves Next's React aliases for server and browser rendering", () => {
  const config: NextConfig = nextConfig
  for (const isServer of [true, false]) {
    const aliases = {
      react: 'next/dist/compiled/react',
      'react-dom': 'next/dist/compiled/react-dom',
      'react-dom/server': 'next/dist/compiled/react-dom/server',
      'react-server-dom-webpack': 'next/dist/compiled/react-server-dom-webpack',
    }
    const webpackConfig = { resolve: { alias: aliases } }
    const result = config.webpack
      ? config.webpack(webpackConfig, { isServer } as Parameters<NonNullable<NextConfig['webpack']>>[1])
      : webpackConfig
    assert.equal(result.resolve.alias, aliases)
    assert.deepEqual(result.resolve.alias, {
      react: 'next/dist/compiled/react',
      'react-dom': 'next/dist/compiled/react-dom',
      'react-dom/server': 'next/dist/compiled/react-dom/server',
      'react-server-dom-webpack': 'next/dist/compiled/react-server-dom-webpack',
    })
  }
})

test("Turbopack keeps framework React resolution instead of forcing workspace packages", () => {
  const config: NextConfig = nextConfig
  const aliases = config.turbopack?.resolveAlias ?? {}
  assert.equal(Object.keys(aliases).some((key) => key === 'react' || key.startsWith('react/') || key === 'react-dom' || key.startsWith('react-dom/')), false)
  assert.ok(config.turbopack?.root)
})

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
