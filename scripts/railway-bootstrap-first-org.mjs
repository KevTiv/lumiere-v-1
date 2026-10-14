#!/usr/bin/env node
// Private one-shot bootstrap. Never log passwords, session tokens or response bodies.
import { createServer } from 'node:http'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing ${name}`)
  return value
}

function privateBase(name) {
  const url = new URL(required(name))
  if (url.protocol !== 'http:' || !url.hostname.endsWith('.railway.internal')) {
    throw new Error(`${name} must use Railway private HTTP`)
  }
  return url
}

async function main() {
  const api = privateBase('LUMIERE_API_SERVER_URL')
  const stdb = privateBase('STDB_HOST')
  const database = encodeURIComponent(required('STDB_MODULE'))
  const admin = required('STDB_SERVER_TOKEN')
  const email = required('BOOTSTRAP_OWNER_EMAIL').toLowerCase()
  const password = required('BOOTSTRAP_OWNER_PASSWORD')
  const name = required('BOOTSTRAP_ORG_NAME')
  const code = required('BOOTSTRAP_ORG_CODE')
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new Error('invalid organization code')

  async function apiRequest(path, token, body) {
    const response = await fetch(new URL(path, api), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status}`)
    return response.json()
  }

  async function organizations() {
    const response = await fetch(new URL(`/v1/database/${database}/sql`, stdb), {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'text/plain' },
      body: `SELECT id, name, code FROM organization WHERE code = '${code}'`,
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`organization verification failed: HTTP ${response.status}`)
    const [result] = await response.json()
    return (result?.rows ?? []).map(row => Object.fromEntries(
      result.schema.elements.map((element, index) => [element.name.some, row[index]]),
    ))
  }

  const credential = await apiRequest('/v1/auth/internal/bootstrap-credential', admin, { email, password })
  if (!credential.token || !credential.identity) throw new Error('credential binding is incomplete')
  let rows = await organizations()
  if (rows.length > 1 || (rows.length && rows[0].name !== name)) throw new Error('organization code conflict')
  let session = await apiRequest('/v1/session/field-access', credential.token)
  if (!rows.length) {
    if (session.organizationId != null) throw new Error('owner already belongs to another organization')
    await apiRequest('/v1/bootstrap/tenant', credential.token, {
      organization: {
        name, code, timezone: process.env.BOOTSTRAP_TIMEZONE || 'Europe/Amsterdam',
        dateFormat: 'yyyy-MM-dd', language: 'en', isActive: true,
        description: null, logoUrl: null, website: null, email, phone: null, currencyId: null, metadata: null,
      },
      defaultCompanyName: name, defaultCompanyCode: code,
      defaultCompanyCurrencyId: 0, defaultCompanyCurrencyCode: process.env.BOOTSTRAP_CURRENCY || 'EUR',
      fiscalYearEndMonth: 12, fiscalYearEndDay: 31, seedFormConfigs: true,
      settings: { moduleConfig: null, featureFlags: [], integrationKeys: null, metadata: null },
    })
    rows = await organizations()
  }
  session = await apiRequest('/v1/session/field-access', credential.token)
  if (rows.length !== 1 || Number(session.organizationId) !== Number(rows[0].id)) {
    throw new Error('owner organization binding was not verified')
  }
  const profile = await apiRequest('/v1/auth/profile', credential.token)
  if (profile.data?.email !== email) throw new Error('owner profile was not verified')
  // Prove the supplied password works; existing credentials are never overwritten.
  await apiRequest('/v1/auth/signin', '', { email, password })
  console.log(`FIRST_ORG_VERIFIED organizationId=${rows[0].id} ownerBound=true passwordSignin=true`)
}

try {
  await main()
  // Railway must observe terminal readiness before this temporary service is removed.
  createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"bootstrap":"verified"}')
  }).listen(Number(process.env.PORT || 8080), '::')
} catch (error) {
  console.error(`FIRST_ORG_FAILED ${error instanceof Error ? error.message : 'unknown failure'}`)
  process.exitCode = 1
}
