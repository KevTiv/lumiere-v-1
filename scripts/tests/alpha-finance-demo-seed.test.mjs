import assert from 'node:assert/strict'
import test from 'node:test'
import { demoContractSchema } from '../demo-contract-schema.mjs'
import { encodeSeedValue, resolveSeedReferences } from '../alpha-demo-seed.mjs'
import { alphaFinanceDemoFixtures, runAlphaFinanceDemoSeed } from '../alpha-finance-demo-seed.mjs'
import { readFileSync } from 'node:fs'

const release = JSON.parse(readFileSync(new URL('../../release-compatibility-manifest.json', import.meta.url)))
const archive = new URL(`../../frontend/vendor/lumiere-contracts-${release.lumiere_contracts.version}.tgz`, import.meta.url).pathname

test('finance scenarios use pinned reducer inputs and complete reference graphs', async () => {
  const fixtures = alphaFinanceDemoFixtures(new Date('2026-10-25T12:00:00Z'))
  const operations = await demoContractSchema(archive, [...new Set([...fixtures.map(row => row.operation), 'post_account_move'])])
  const ids = Object.fromEntries(['company', 'currency', 'customer', 'customer2', 'vendor', 'receivable', 'payable', 'income',
    'expenseAccount', 'salesJournal', 'purchaseJournal', 'bankJournal'].map((key, i) => [key, i + 1]))
  for (const fixture of fixtures) {
    const input = { ...resolveSeedReferences(fixture.input, ids), organizationId: 1 }
    for (const [key, type] of Object.entries(operations[fixture.operation].fields)) encodeSeedValue(type, input[key], `${fixture.key}.${key}`)
    resolveSeedReferences(fixture.match, ids)
    assert.equal(ids[fixture.key], undefined, `duplicate fixture key ${fixture.key}`)
    ids[fixture.key] = Object.keys(ids).length + 100
  }
  const invoices = fixtures.filter(row => row.table === 'account_move')
  assert.equal(invoices.length, 8)
  assert.equal(invoices.filter(row => row.post).length, 6)
  assert.equal(new Set(invoices.map(row => row.input.params.idempotencyKey)).size, 8)
  assert.ok(invoices.every(row => row.input.params.lines[0].priceUnit > 0))
  assert.deepEqual(fixtures, alphaFinanceDemoFixtures(new Date('2026-10-25T12:00:00Z')))
})

test('public hosts, non-production environments and missing actor credentials fail closed', async () => {
  const payload = { fixtures: [], operations: {} }
  await assert.rejects(runAlphaFinanceDemoSeed(payload, { STDB_HOST: 'https://example.test' }), /private network/)
  await assert.rejects(runAlphaFinanceDemoSeed(payload, { STDB_HOST: 'http://stdb.railway.internal', RAILWAY_ENVIRONMENT_NAME: 'staging' }), /private network/)
  await assert.rejects(runAlphaFinanceDemoSeed(payload, { STDB_HOST: 'http://stdb.railway.internal', RAILWAY_ENVIRONMENT_NAME: 'production' }), /existing actor credentials/)
})
