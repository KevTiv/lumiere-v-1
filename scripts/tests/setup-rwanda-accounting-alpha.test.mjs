import assert from 'node:assert/strict'
import test from 'node:test'

import { rehearsalEnvIds, setupConfig } from '../setup-rwanda-accounting-alpha.mjs'

function valid(overrides = {}) {
  return {
    LUMIERE_API_SERVER_URL: 'http://api.railway.internal',
    STDB_HOST: 'http://stdb.railway.internal',
    STDB_MODULE: 'rw-rehearsal',
    STDB_SERVER_TOKEN: 'secret-owner-token',
    RWANDA_SETUP_ISOLATED_TENANT_ACK: '1',
    RWANDA_SETUP_TENANT_REF: 'rw-isolated-01',
    RWANDA_SETUP_ORG_NAME: 'Rwanda rehearsal',
    RWANDA_SETUP_ORG_CODE: 'rwalpha',
    RWANDA_SETUP_OWNER_EMAIL: 'owner@example.test',
    RWANDA_SETUP_OWNER_PASSWORD: 'owner-secret',
    RWANDA_SETUP_PERSONA_PASSWORD: 'persona-secret',
    RWANDA_SETUP_CUTOVER_DATE: '2026-10-01',
    ...overrides,
  }
}

test('configuration pins an acknowledged private isolated Rwanda target', () => {
  const config = setupConfig(valid())
  assert.equal(config.orgCode, 'RWALPHA')
  assert.equal(config.fiscalYear, 2026)
  assert.equal(config.operatorEmail, 'rw.alpha.operator@example.test')
  assert.equal(config.readerEmail, 'fixture.reader@example.test')
})

test('public hosts and missing isolation acknowledgement fail before setup', () => {
  assert.throws(() => setupConfig(valid({ LUMIERE_API_SERVER_URL: 'https://public.example.test' })), /private HTTP/)
  assert.throws(() => setupConfig(valid({ RWANDA_SETUP_ISOLATED_TENANT_ACK: '0' })), /must be 1/)
  assert.throws(() => setupConfig(valid({ RWANDA_SETUP_TENANT_REF: 'unsafe\nE2E_TEST_PASSWORD=x' })), /invalid RWANDA_SETUP_TENANT_REF/)
  assert.throws(() => setupConfig(valid({ RWANDA_SETUP_CUTOVER_DATE: '2026-02-31' })), /must be YYYY-MM-DD/)
  assert.throws(() => setupConfig(valid({ RWANDA_SETUP_PERSONA_PASSWORD: 'short' })), /at least 8 characters/)
  assert.throws(() => setupConfig(valid({ RWANDA_SETUP_OPERATOR_EMAIL: 'owner@example.test' })), /four distinct email addresses/)
})

test('safe output contains only rehearsal identifiers and no credential values', () => {
  const output = rehearsalEnvIds({
    tenantRef: 'rw-isolated-01', companyId: 12, operatorEmail: 'operator@example.test', customerId: 20, vendorId: 21,
  })
  assert.match(output, /E2E_RWANDA_EXPECTED_COMPANY_ID=12/)
  assert.match(output, /E2E_RWANDA_CUSTOMER_PARTNER_ID=20/)
  assert.doesNotMatch(output, /PASSWORD|TOKEN|secret/i)
})
