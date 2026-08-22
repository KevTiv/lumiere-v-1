#!/usr/bin/env node
/**
 * Local e2e-smoke: obtain the SpacetimeDB **database owner** token for HTTP SQL.
 *
 * Private tables (e.g. user_credential) reject SQL from anonymous POST /v1/identity
 * tokens. The owner token comes from `spacetime login --server-issued-login local`
 * and lives in ~/.config/spacetime/cli.toml.
 *
 * Usage:
 *   # Before publish — establish owner identity (Makefile e2e-smoke)
 *   E2E_STDB_HOST=http://127.0.0.1:3000 node scripts/e2e-local-stdb-token.mjs --login-only
 *
 *   # After publish — read owner token and verify private-table SQL access
 *   STDB_MODULE=lumiere-v1-j1uo0 E2E_STDB_HOST=http://127.0.0.1:3000 node scripts/e2e-local-stdb-token.mjs
 *
 *   # Preflight only (token already in STDB_SERVER_TOKEN)
 *   STDB_SERVER_TOKEN=... STDB_MODULE=... node scripts/e2e-local-stdb-token.mjs --verify
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
)

function isLocalHost(hostUrl) {
  try {
    const u = new URL(hostUrl.startsWith('http') ? hostUrl : `https://${hostUrl}`)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
  } catch {
    return false
  }
}

function readCliToken() {
  const p = join(homedir(), '.config', 'spacetime', 'cli.toml')
  if (!existsSync(p)) return null
  const text = readFileSync(p, 'utf8')
  const m = text.match(/spacetimedb_token\s*=\s*"([^"]+)"/)
  return m ? m[1].trim() : null
}

function moduleNameFromEnv() {
  return process.env.STDB_MODULE?.trim() || process.env.NEXT_PUBLIC_STDB_MODULE?.trim() || ''
}

function loginLocal({ forceLogout = false } = {}) {
  if (forceLogout) {
    spawnSync('spacetime', ['logout'], { stdio: 'ignore' })
  }

  const serverArg = isLocalHost(host) ? 'local' : host
  const result = spawnSync('spacetime', ['login', '--server-issued-login', serverArg, '--no-browser'], {
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0 && !output.toLowerCase().includes('already logged in')) {
    console.error(output.trim() || 'spacetime login --server-issued-login failed')
    process.exit(1)
  }
}

function cliTokenAcceptedByCurrentServer() {
  const serverArg = isLocalHost(host) ? 'local' : host
  const result = spawnSync('spacetime', ['list', '--server', serverArg, '--yes'], {
    stdio: 'ignore',
  })
  return result.status === 0
}

async function verifyPrivateAuthSql(token, moduleName) {
  if (!moduleName) {
    console.error('[e2e-stdb-token] STDB_MODULE (or NEXT_PUBLIC_STDB_MODULE) is required for --verify')
    process.exit(1)
  }

  const url = `${host}/v1/database/${moduleName}/sql`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: 'SELECT identity FROM user_credential LIMIT 1',
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[e2e-stdb-token] Private auth SQL probe failed: ${res.status} ${body}`)
    console.error(
      '[e2e-stdb-token] api-server sign-in requires the database owner token. ' +
        'Run: spacetime login --server-issued-login local (then publish as that identity).',
    )
    process.exit(1)
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))

  if (args.has('--login-only')) {
    // Keep an existing identity when the running server accepts it. A freshly
    // started local server may reject a token signed by a prior local or cloud
    // server, in which case replace it before publishing.
    const forceLogout = process.env.E2E_FORCE_LOCAL_LOGIN === '1'
    const token = readCliToken()
    if (!forceLogout && token && cliTokenAcceptedByCurrentServer()) return
    loginLocal({ forceLogout: forceLogout || Boolean(token) })
    const refreshedToken = readCliToken()
    if (!refreshedToken || !cliTokenAcceptedByCurrentServer()) {
      console.error('[e2e-stdb-token] Local login did not produce a token accepted by this server')
      process.exit(1)
    }
    return
  }

  if (args.has('--verify')) {
    const token = process.env.STDB_SERVER_TOKEN?.trim()
    if (!token) {
      console.error('[e2e-stdb-token] STDB_SERVER_TOKEN is required for --verify')
      process.exit(1)
    }
    await verifyPrivateAuthSql(token, moduleNameFromEnv())
    return
  }

  let token = readCliToken()
  if (!token) {
    loginLocal({ forceLogout: false })
    token = readCliToken()
  }
  if (!token) {
    console.error(
      '[e2e-stdb-token] No spacetimedb_token in ~/.config/spacetime/cli.toml. ' +
        'Run with --login-only before publish, or: spacetime login --server-issued-login local',
    )
    process.exit(1)
  }

  const moduleName = moduleNameFromEnv()
  if (moduleName) {
    await verifyPrivateAuthSql(token, moduleName)
  }

  process.stdout.write(token)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
