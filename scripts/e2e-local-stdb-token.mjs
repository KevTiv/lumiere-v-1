#!/usr/bin/env node
/**
 * Fetch a fresh SpacetimeDB identity token from a local server (e2e-smoke).
 * Usage: E2E_STDB_HOST=http://127.0.0.1:3000 node scripts/e2e-local-stdb-token.mjs
 */
const host = (process.env.E2E_STDB_HOST ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const res = await fetch(`${host}/v1/identity`, { method: 'POST' })
if (!res.ok) {
  console.error(`Failed to obtain token: ${res.status} ${await res.text()}`)
  process.exit(1)
}
const body = await res.json()
if (!body?.token) {
  console.error('Identity response missing token')
  process.exit(1)
}
process.stdout.write(body.token)
