/**
 * Smoke-test fixture: ensures `seed_dev_data` has run so "Lumiere Demo Corp" and reference ERP data exist.
 * Idempotent: `seed_dev_data` no-ops if that org already exists (see spacetimedb/src/seed.rs).
 *
 * Run after `spacetime publish` and before seed-test-user (same STDB_* env).
 *
 *   pnpm --dir frontend/web run e2e-seed-fixture
 */

import {
  loadEnvLocal,
  getStdbHost,
  resolveStdbToken,
  callStdbReducer,
  getRequiredModuleName,
} from './stdb-http-seed-shared.mjs'

async function main() {
  loadEnvLocal()
  const host = getStdbHost()
  const moduleName = getRequiredModuleName('e2e-seed-fixture')
  const token = resolveStdbToken(host)

  await callStdbReducer(host, moduleName, token, 'dev_promote_caller_superuser', [])
  console.log('[e2e-seed-fixture] dev_promote_caller_superuser OK.')

  await callStdbReducer(host, moduleName, token, 'seed_dev_data', [])
  console.log(
    '[e2e-seed-fixture] seed_dev_data OK (new schema + full demo fixture, or skipped if already seeded).',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
