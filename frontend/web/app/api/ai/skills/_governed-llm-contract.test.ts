import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTrustedGovernedLlmRequest } from './_governed-llm-contract'

test('trusted governed skill request keeps tenant and actor authority out of JSON', () => {
  const request = buildTrustedGovernedLlmRequest(
    {
      inputs: { query: 'revenue' },
      agentId: 7,
      teamMemberId: null,
      maxSteps: 4,
      resumeRunId: null,
      orgPrivacyPolicy: {
        allowedFields: [],
        maskedFields: ['margin'],
        suppressedFields: [],
        maskPhoneFields: true,
        maskPaymentReferences: true,
        suppressSecrets: true,
      },
    },
    {
      organizationId: 11,
      companyId: 13,
      actorIdentity: 'a'.repeat(64),
      stdbToken: 'session-token',
    },
  )

  assert.deepEqual(request.headers, {
    'x-lumiere-organization-id': '11',
    'x-lumiere-company-id': '13',
    'x-lumiere-actor-identity': 'a'.repeat(64),
    'x-lumiere-actor-token': 'session-token',
  })
  assert.deepEqual(request.body, {
    inputs: { query: 'revenue' },
    agentId: 7,
    teamMemberId: null,
    maxSteps: 4,
    resumeRunId: null,
    orgPrivacyPolicy: {
      allowedFields: [],
      maskedFields: ['margin'],
      suppressedFields: [],
      maskPhoneFields: true,
      maskPaymentReferences: true,
      suppressSecrets: true,
    },
  })
  for (const forbidden of [
    'orgId',
    'companyId',
    'identityHex',
    'stdbToken',
    'org_id',
    'company_id',
    'identity_hex',
    'stdb_token',
  ]) {
    assert.equal(forbidden in request.body, false)
  }
})
