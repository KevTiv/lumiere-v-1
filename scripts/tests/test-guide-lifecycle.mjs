import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { guideEvidenceFixtureArguments, guideInspectionFixtureGrantArguments, guideRoleUpdateParams, requireIsolatedCi } from '../run-guide-lifecycle.mjs'

const fixture = { CI: 'true', GITHUB_ACTIONS: 'true', STDB_HOST: 'http://127.0.0.1:3000',
  STDB_MODULE: 'lumiere-v1-local-e2e', LUMIERE_API_SERVER_URL: 'http://127.0.0.1:8082',
  PG_HOST: '127.0.0.1', PG_DATABASE: 'lumiere', GITHUB_SHA: 'a'.repeat(40) }

test('real-service lifecycle admits only its hosted loopback fixture', () => {
  assert.doesNotThrow(() => requireIsolatedCi(fixture))
  for (const [key, value] of Object.entries({ CI: 'false', GITHUB_ACTIONS: '',
    STDB_HOST: 'https://maincloud.spacetimedb.com', STDB_MODULE: 'production',
    LUMIERE_API_SERVER_URL: 'https://api.example.com', PG_HOST: 'postgres.example.com',
    PG_DATABASE: 'production', GITHUB_SHA: 'main' })) {
    assert.throws(() => requireIsolatedCi({ ...fixture, [key]: value }), { name: 'AssertionError' }, key)
  }
})

test('ordinary guide access fixture supplies every native SATS role field', async () => {
  const native = await readFile(new URL('../../spacetimedb/src/core/permissions.rs', import.meta.url), 'utf8')
  const params = native.match(/pub struct UpdateRoleParams\s*\{([^}]+)\}/)?.[1]
  assert.ok(params, 'The authoritative native role wire schema must be available')
  const fields = [...params.matchAll(/pub\s+(\w+)\s*:/g)].map((match) => match[1])
  assert.ok(fields.length > 0, 'Native role fields must be resolved')
  const permissions = ['organization:read', 'knowledge_article:*']
  const fixtureParams = guideRoleUpdateParams(permissions)
  assert.deepEqual(Object.keys(fixtureParams).sort(), fields.sort(),
    'SATS requires explicit fields even when the native field is optional')
  for (const [, name, type] of params.matchAll(/pub\s+(\w+)\s*:\s*([^\n]+),/g)) {
    if (type.startsWith('Option<')) {
      const value = fixtureParams[name]
      assert.ok(value && typeof value === 'object' && Object.keys(value).length === 1 &&
        ('some' in value || Array.isArray(value.none)), `${name} must retain generated SATS option encoding`)
    }
  }
  assert.deepEqual(fixtureParams.permissions, { some: permissions })
  assert.deepEqual(fixtureParams.metadata, { none: [] })
})

test('internal evidence setup matches fixed native contracts without admitting human reviews', async () => {
  const contract = await readFile(new URL('../../crates/stdb-client/src/generated_reducer_contract.rs', import.meta.url), 'utf8')
  const cases = [
    ['record_ai_evidence_source', { params: {} }],
    ['record_ai_evidence_source_version', { sourceId: 11, params: {} }],
    ['record_ai_evidence_passage', { params: {} }],
    ['record_ai_evidence_claim', { params: {} }],
    ['record_ai_evidence_decision', { params: {} }],
    ['set_ai_evidence_passage_status', { passageId: 12, status: 'withdrawn' }],
    ['record_ai_evidence_source_change', { sourceVersionId: 13, params: {} }],
  ]
  for (const [reducer, data] of cases) {
    const declaration = contract.split('\n').find((line) => line.includes(`ReducerContract { name: "${reducer}"`))
    assert.ok(declaration?.includes('exposure: Exposure::Denied'), `${reducer} must remain internal`)
    const parameterName = declaration.match(/params: (PARAMS_\w+)/)?.[1]
    const parameters = contract.match(new RegExp(`const ${parameterName}: &\\[ReducerParam\\] = &\\[([\\s\\S]*?)\\n\\];`))?.[1]
    assert.ok(parameters, `${reducer} native parameters must be resolved`)
    const names = [...parameters.matchAll(/ReducerParam \{ name: "([^"]+)"/g)].map((match) => match[1])
    const fields = Object.keys(data)
    assert.deepEqual(names, ['organization_id', 'company_id', ...fields.map((field) => field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))])
    assert.deepEqual(guideEvidenceFixtureArguments(reducer, 7, { companyId: 10, ...data }), [7, 10, ...Object.values(data)])
  }
  for (const reducer of ['review_ai_evidence_claim', 'review_ai_evidence_decision', 'review_ai_knowledge_entry', 'dev_promote_caller_superuser']) {
    assert.throws(() => guideEvidenceFixtureArguments(reducer, 7, { companyId: 10, params: {} }))
  }
  assert.throws(() => guideEvidenceFixtureArguments('record_ai_evidence_source', 0, { companyId: 10, params: {} }))
  assert.throws(() => guideEvidenceFixtureArguments('record_ai_evidence_source', 7, { companyId: 0, params: {} }))
  assert.throws(() => guideEvidenceFixtureArguments('record_ai_evidence_source', 7, { companyId: 10, params: {}, actor: 'other' }))
})

test('inspection fixture grants only the bounded read-only owner baseline capability', async () => {
  const source = await readFile(new URL('../../spacetimedb/src/ai/capability_grants.rs', import.meta.url), 'utf8')
  assert.match(source, /capability_key: "ai\.evidence\.inspect",\s*max_rows: 100,\s*max_bytes: 1024 \* 1024,/)
  assert.deepEqual(guideInspectionFixtureGrantArguments(7, 2), [7, 2, 'ai.evidence.inspect', 100, 1048576, true])
  assert.throws(() => guideInspectionFixtureGrantArguments(0, 2))
  assert.throws(() => guideInspectionFixtureGrantArguments(7, 0))
})
