/**
 * Shared helpers for HTTP calls to SpacetimeDB (/v1/database/...).
 * Used by seed-test-user.mjs and e2e-seed-fixture.mjs.
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

/** Parse frontend/web/.env.local: last duplicate key wins; only fills process.env keys that are empty. */
export function loadEnvLocal() {
  const p = join(SCRIPT_DIR, '..', '.env.local')
  if (!existsSync(p)) return
  const text = readFileSync(p, 'utf8')
  const map = new Map()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    map.set(k, v)
  }
  for (const [k, v] of map) {
    if (!String(process.env[k] ?? '').trim() && String(v).trim()) {
      process.env[k] = v
    }
  }
}

export function getStdbHost() {
  const raw =
    process.env['STDB_HOST'] ??
    process.env['NEXT_PUBLIC_STDB_HOST'] ??
    'https://maincloud.spacetimedb.com'
  return raw.replace(/^wss?:\/\//, 'https://').replace(/\/$/, '')
}

const TOKEN_PLACEHOLDERS = new Set([
  'your-server-token-here',
  'changeme',
  'replace-me',
  'replace_me',
])

function isLocalStdbHost(hostUrl) {
  try {
    const u = new URL(hostUrl.startsWith('http') ? hostUrl : `https://${hostUrl}`)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
  } catch {
    return false
  }
}

function readSpacetimeCliTomlToken() {
  const p = join(homedir(), '.config', 'spacetime', 'cli.toml')
  if (!existsSync(p)) return null
  const text = readFileSync(p, 'utf8')
  const m = text.match(/spacetimedb_token\s*=\s*"([^"]+)"/)
  return m ? m[1].trim() : null
}

function jwtIssuerUnsafe(token) {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    return typeof payload.iss === 'string' ? payload.iss : null
  } catch {
    return null
  }
}

export function resolveStdbToken(host) {
  let t = process.env['STDB_SERVER_TOKEN']?.trim() ?? ''
  if (!t || TOKEN_PLACEHOLDERS.has(t.toLowerCase())) {
    t = readSpacetimeCliTomlToken() ?? ''
  }
  if (!t) {
    throw new Error(
      'STDB_SERVER_TOKEN is missing or still a placeholder. Set it in frontend/web/.env.local to a real JWT, ' +
        'or run `spacetime login` (maincloud) or `spacetime login --server-issued-login local` (local server) ' +
        'so ~/.config/spacetime/cli.toml contains spacetimedb_token.',
    )
  }

  const local = isLocalStdbHost(host)
  const iss = jwtIssuerUnsafe(t)
  if (local && iss && iss.includes('auth.spacetimedb.com')) {
    throw new Error(
      `STDB_SERVER_TOKEN is a maincloud login JWT, but NEXT_PUBLIC_STDB_HOST targets a local server (${host}). ` +
        'SpacetimeDB tokens are not portable between clusters.\n' +
        'Run:\n' +
        '  spacetime login --server-issued-login local\n' +
        'Then set STDB_SERVER_TOKEN to the spacetimedb_token in ~/.config/spacetime/cli.toml (or export it) and re-run. ' +
        'If you use maincloud, set NEXT_PUBLIC_STDB_HOST to https://maincloud.spacetimedb.com instead.',
    )
  }

  return t
}

export function authErrorHint(host, status, body) {
  if (status !== 401) return ''
  const local = isLocalStdbHost(host)
  const extra = local
    ? ' For local: use a token from `spacetime login --server-issued-login local`, not a maincloud-only token.'
    : ' Check `spacetime login` and that STDB_SERVER_TOKEN matches spacetimedb_token in ~/.config/spacetime/cli.toml.'
  return (
    `\n(${status} ${body.trim()}. JWT may be wrong/expired or for a different cluster.${extra})`
  )
}

export async function callStdbReducer(host, moduleName, token, reducerName, args) {
  if (!token) throw new Error('STDB_SERVER_TOKEN is not configured')
  const url = `${host}/v1/database/${moduleName}/call/${reducerName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Reducer ${reducerName} failed: ${res.status} ${body}${authErrorHint(host, res.status, body)}`,
    )
  }
}

export function getRequiredModuleName(scriptLabel = 'seed') {
  const m =
    process.env['STDB_MODULE']?.trim() || process.env['NEXT_PUBLIC_STDB_MODULE']?.trim()
  if (!m) {
    console.error(
      `[${scriptLabel}] Missing STDB_MODULE or NEXT_PUBLIC_STDB_MODULE.\n` +
        'Set to your published SpacetimeDB database name (same as `make publish` / `spacetime publish <name>`).\n' +
        'Example in frontend/web/.env.local:\n' +
        '  STDB_MODULE=lumiere-v1-j1uo0\n' +
        '  NEXT_PUBLIC_STDB_MODULE=lumiere-v1-j1uo0',
    )
    process.exit(1)
  }
  return m
}
