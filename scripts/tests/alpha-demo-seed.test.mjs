import assert from 'node:assert/strict'
import test from 'node:test'
import { alphaSeedPayload } from '../demo-contract-schema.mjs'
import { encodeSeedValue, resolveSeedReferences, runAlphaDemoSeed } from '../alpha-demo-seed.mjs'

test('fixtures consume pinned session contracts and have complete typed reference graphs', async () => {
  const payload = await alphaSeedPayload(new URL('../../frontend/vendor/lumiere-contracts-0.3.106.tgz', import.meta.url).pathname)
  const ids = { company: 1, currency: 2, ownerIdentity: 'a'.repeat(64) }
  const keys = new Set()
  for (const fixture of payload.fixtures) {
    const table = payload.schema.tables.find(table => table.name === fixture.table)
    assert.ok(table, `missing table ${fixture.table}`)
    for (const field of Object.keys(fixture.match)) assert.ok(table.columns.includes(field), `${fixture.key}: missing lookup column ${field}`)
    assert.ok(!keys.has(fixture.key), `duplicate ${fixture.key}`)
    const input = resolveSeedReferences(fixture.input, ids)
    const operation = payload.schema.operations[fixture.operation]
    for (const [field, type] of Object.entries(operation.fields)) {
      if (field === 'organizationId') continue
      if (type.kind === 'object') encodeSeedValue(type, input[field], `${fixture.key}.${field}`)
      else assert.ok(field in input, `${fixture.key} missing ${field}`)
    }
    resolveSeedReferences(fixture.match, ids)
    ids[fixture.key] = keys.size + 100
    keys.add(fixture.key)
  }
  assert.ok(payload.schema.tables.length > 100)
  assert.ok(payload.fixtures.length > 80)
})

test('missing references and invalid enums fail before a mutation is attempted', () => {
  assert.throws(() => resolveSeedReferences('@missing', {}), /unavailable/)
  assert.throws(() => encodeSeedValue({ kind: 'enum', fields: { Draft: {} } }, 'Posted'), /Invalid fixture enum/)
  assert.deepEqual(encodeSeedValue({ kind: 'option', element: { kind: 'u64' } }, null), { none: [] })
})

test('wire names preserve numeric word boundaries and keep optional fields explicit', () => {
  const output = encodeSeedValue({ kind: 'object', fields: { street2: { kind: 'option', element: { kind: 'string' } } } }, {})
  assert.deepEqual(output, { street_2: { none: [] } })
})

test('public network hosts and non-Alpha targets fail before credentials are read', async () => {
  await assert.rejects(runAlphaDemoSeed({ LUMIERE_API_SERVER_URL: 'https://public.example.test', STDB_HOST: 'http://stdb.railway.internal' }), /private HTTP/)
  await assert.rejects(runAlphaDemoSeed({ LUMIERE_API_SERVER_URL: 'http://api.railway.internal', STDB_HOST: 'http://stdb.railway.internal',
    RAILWAY_ENVIRONMENT_NAME: 'production', SEED_ORG_CODE: 'OTHER', SEED_ORG_NAME: 'Other' }), /Alpha production tenant/)
})
