import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const root = new URL('../../frontend/web/', import.meta.url)
const organizationId = 17
const companyId = 23
const identityHex = 'a'.repeat(64)

if (process.argv[2] === 'bindings') {
  const { nativeVersionManifest } = await import(
    new URL('app/(modules)/ai-skills/native-skill-validation.ts', root)
  )
  const bindings = JSON.parse(readFileSync(0, 'utf8'))
  for (const binding of bindings) {
    const manifest = JSON.parse(nativeVersionManifest(binding, binding.manifest.version))
    assert.equal(manifest.skill_key, binding.skillKey)
    assert.equal(manifest.source_hash, binding.manifest.source_hash)
    assert.equal(manifest.version, binding.manifest.version)
  }
  process.exit(0)
}

if (process.argv[2] === 'results') {
  const { parseLowStockScanResult, parseReportComposerResult } = await import(
    new URL('../packages/query-hooks/src/hooks/ai-green-skill-results.ts', root)
  )
  const { lowStock, report } = JSON.parse(readFileSync(0, 'utf8'))
  const stockResult = parseLowStockScanResult(lowStock)
  assert.deepEqual(stockResult.items, [{
    organizationId, companyId, productId: 31, sku: 'TAPE', name: 'Tape',
    quantityOnHand: 2, reorderLevel: 5,
  }])
  assert.equal(stockResult.decision.decision.correlation.companyId, companyId)
  const reportResult = parseReportComposerResult(report)
  assert.equal(reportResult.decision.privacy.rowsProcessed, 1)
  assert.equal(reportResult.citations[0].valueMinorUnits, 123)
  assert.equal(reportResult.summaryVerification.outcome, 'blocked')
  assert.equal(reportResult.summaryProvenance.persisted, false)
  assert.equal(reportResult.audit.correlationId, 'wire-contract')
  process.exit(0)
}

assert.equal(process.argv[2], 'requests')

// Only replace the framework and authenticated session dependencies. The real
// BFF handlers, scope checks, serializers and gateway transport run below.
const stubs = new Map([
  ['next/server', 'export const NextResponse = Response'],
  ['server-only', ''],
  ['@/lib/api-session', `export async function resolveApiSession() {
    return { organizationId: ${organizationId}, stdbToken: 'test-token', identityHex: '${identityHex}' }
  }`],
  ['@/lib/company-scope-server', `export async function companyIdBelongsToOrganization(session, id) {
    return session.organizationId === ${organizationId} && id === ${companyId}
  }`],
  ['@/lib/stdb-reducer', 'export async function callReducer() { throw new Error("unexpected reducer call") }'],
])
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubs.has(specifier)) {
      return { url: 'data:text/javascript,' + encodeURIComponent(stubs.get(specifier)), shortCircuit: true }
    }
    if (specifier === '@lumiere/erp-shared/u64') {
      return nextResolve(new URL('../packages/erp-shared/src/u64.ts', root).href, context)
    }
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(specifier.slice(2) + '.ts', root).href, context)
    }
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
})

process.env.LUMIERE_AI_ENABLED = 'true'
process.env.LUMIERE_AI_GATEWAY_URL = 'https://gateway.invalid'
process.env.LUMIERE_AI_GATEWAY_INTERNAL_SECRET = 'test-gateway-secret'
const forwarded = []
globalThis.fetch = async (url, init) => {
  const target = new URL(url)
  assert.equal(target.origin, 'https://gateway.invalid')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.get('content-type'), 'application/json')
  assert.equal(init.headers.get('x-lumiere-gateway-secret'), 'test-gateway-secret')
  forwarded.push({ path: target.pathname, body: JSON.parse(init.body) })
  return Response.json({})
}

const cases = [
  ['inventory/low-stock', '/v1/skills/inventory/low-stock', { threshold: 5, locationId: 31 }],
  ['inventory/low-stock', '/v1/skills/inventory/low-stock', { threshold: 5 }],
  ['report/compose', '/v1/skills/report/compose', {
    reportKey: 'daily_business_summary_v1', date: '2026-11-13', timezone: 'Europe/Amsterdam',
  }],
  ['distributor/credit-hold-summary', '/v1/skills/distributor/credit-hold-summary', { minimumOutstanding: 100 }],
  ['distributor/delivery-run-summary', '/v1/skills/distributor/delivery-run-summary', { includeDone: true }],
  ['skills/insights-scan', '/v1/skills/insights-scan', { maxInsights: 3, abnormalAmountThreshold: 250 }],
  ['skills/daily-briefing', '/v1/skills/daily-briefing', {
    sinceMicros: 1000, untilMicros: 2000, allowedModules: ['inventory'], activityQuery: 'stock', topK: 2,
  }],
  ...['process-research', 'price-search', 'supplier-discovery'].map(skill => [
    'skills/' + skill, '/v1/skills/' + skill, { inputs: { itemName: 'Tape' }, agentId: 5, maxSteps: 2 },
  ]),
  ['policy/evaluate', '/v1/policy/evaluate', {
    skill: { skillKey: 'low_stock', version: 1 },
    correlationId: 'contract-test',
    plan: {
      namedResources: ['inventory.low_stock.v1'],
      toolCalls: [{
        toolName: 'named_resource_read', capability: 'named_read', namedResource: 'inventory.low_stock.v1',
      }],
      steps: 1, expectedRows: 1, outputType: 'inventory.low_stock.result.v1',
    },
    input: { location_id: 31 },
    candidateOutput: { items: [{ quantity_on_hand: 2 }] },
  }],
]

for (const [route, path, input] of cases) {
  const { POST } = await import(new URL('app/api/ai/' + route + '/route.ts', root))
  const count = forwarded.length
  const response = await POST(new Request('https://web.invalid/api/ai/' + route, {
    method: 'POST',
    body: JSON.stringify({ ...input, companyId, orgId: 999, stdbToken: 'ignored-browser-token' }),
  }))
  assert.equal(response.status, 200, route + ': ' + await response.text())
  assert.equal(forwarded.length, count + 1, route)
  assert.equal(forwarded.at(-1).path, path, route)
}

console.log(JSON.stringify(forwarded))
