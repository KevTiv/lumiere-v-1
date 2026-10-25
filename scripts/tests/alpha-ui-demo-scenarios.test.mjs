import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { alphaUiDemoScenarios } from '../alpha-ui-demo-scenarios.mjs'
import { demoContractSchema } from '../demo-contract-schema.mjs'
import { encodeSeedValue, resolveSeedReferences } from '../alpha-demo-seed.mjs'

const release = JSON.parse(readFileSync(new URL('../../release-compatibility-manifest.json', import.meta.url)))
const archive = new URL(`../../frontend/vendor/lumiere-contracts-${release.lumiere_contracts.version}.tgz`, import.meta.url).pathname

test('Alpha scenarios have complete, ordered references and pinned command inputs', async () => {
  const payload = alphaUiDemoScenarios(new Date('2026-10-25T12:00:00Z'))
  const tables = new Set(execFileSync('tar', ['-tzf', archive]).toString().split('\n')
    .flatMap(path => path.match(/^package\/dist\/generated\/(.*)_table\.js$/)?.[1] ?? []))
  const names = [...new Set(payload.fixtures.flatMap(row => [row.operation, ...(row.actions ?? []).map(a => a.operation)]).filter(Boolean))]
  const operations = await demoContractSchema(archive, names)
  const ids = Object.fromEntries(['company', 'currency', 'customer', 'customer2', 'vendor', 'receivable', 'payable', 'income',
    'expenseAccount', 'salesJournal', 'purchaseJournal', 'bankJournal', ...payload.prerequisites.map(([key]) => key)].map((key, i) => [key, i + 1]))
  ids.actor = 'c200' + '1'.repeat(60)
  const check = (operation, input) => {
    const resolved = { ...resolveSeedReferences(input, ids), organizationId: 1 }
    for (const [field, type] of Object.entries(operations[operation].fields)) encodeSeedValue(type, resolved[field], `${operation}.${field}`)
  }
  for (const fixture of payload.fixtures) {
    assert.ok(tables.has(fixture.table), `unknown pinned table ${fixture.table}`)
    const source = execFileSync('tar', ['-xOf', archive, `package/dist/generated/${fixture.table}_table.js`]).toString()
    const columns = new Set(source.split('\n').flatMap(line => {
      const key = line.match(/^\s+(\w+):/)
      return key ? [line.match(/\.name\("([^"]+)"\)/)?.[1] ?? key[1]] : []
    }))
    for (const field of Object.keys(fixture.match)) assert.ok(columns.has(field), `unknown match ${fixture.table}.${field}`)
    resolveSeedReferences(fixture.match, ids)
    assert.equal(ids[fixture.key], undefined, `duplicate key ${fixture.key}`)
    const input = fixture.blob ? { ...fixture.input, params: { ...fixture.input.params, storageKey: 'verified-test-blob',
      contentHash: 'a'.repeat(64), fileName: fixture.blob.fileName, mimeType: fixture.blob.contentType } } : fixture.input
    if (fixture.operation) check(fixture.operation, input)
    ids[fixture.key] = Object.keys(ids).length + 100
    for (const action of fixture.actions ?? []) {
      check(action.operation, action.input)
      resolveSeedReferences(action.expect, ids)
      assert.ok(Object.keys(action.before).length > 0)
      assert.ok(Object.keys(action.expect).length > 0)
    }
  }
  assert.equal(payload.fixtures.filter(row => row.blob).length, 6)
  assert.equal(payload.fixtures.filter(row => row.operation === 'create_opportunity').length, 8)
  assert.ok(payload.fixtures.filter(row => row.operation === 'create_opportunity').every(row => row.input.params.companyCurrencyId === '@currency'))
  assert.ok(payload.fixtures.filter(row => row.operation === 'create_calendar_event').every(row => row.input.params.state === 'confirmed'))
  assert.ok(!names.some(name => /pay_|reimburse|dispatch|email|deliver|process_payment/.test(name)))
  assert.deepEqual(payload, alphaUiDemoScenarios(new Date('2026-10-25T12:00:00Z')))
})

test('record follow-up targets retain their exact parent ID in the tagged payload', async () => {
  const operations = await demoContractSchema(archive, ['create_activity'])
  const target = operations.create_activity.fields.params.fields.target
  assert.deepEqual(encodeSeedValue(target, { SaleOrder: 4097 }), { some: { saleOrder: 4097 } })
  assert.throws(() => encodeSeedValue(target, 'SaleOrder'), /Missing fixture enum payload/)
  assert.throws(() => encodeSeedValue(target, { SaleOrder: 1, PurchaseOrder: 2 }), /Invalid fixture enum/)
})
