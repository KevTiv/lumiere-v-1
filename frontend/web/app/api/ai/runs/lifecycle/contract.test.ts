import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGatewayLifecycleRequest, parseLifecycleBrowserBody } from './contract'

const continuation = { runId: 7, checkpointHash: 'a'.repeat(64), cursor: 4, concurrencyVersion: 2 }

test('accepts only bounded typed lifecycle intents', () => {
  assert.deepEqual(parseLifecycleBrowserBody({ companyId: 3, intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } }), {
    companyId: 3,
    intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' },
  })
  assert.ok(parseLifecycleBrowserBody({ companyId: 3, intent: { kind: 'reply', continuation, questionId: 8, expectedQuestionRevision: 1, answer: { text: 'yes' }, idempotencyKey: 'reply-1' } }))
  assert.equal(parseLifecycleBrowserBody({ companyId: 3, intent: { kind: 'resume', continuation: { ...continuation, checkpointHash: 'forged' }, idempotencyKey: 'resume-1' } }), null)
})

test('rejects browser authority and unknown dispatch fields', () => {
  for (const body of [
    { companyId: 3, organizationId: 9, intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } },
    { companyId: 3, actorIdentity: 'forged', intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } },
    { companyId: 3, token: 'forged', intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } },
    { companyId: 3, intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1', reducer: 'anything' } },
    { companyId: 3, intent: { kind: 'unknown', continuation } },
  ]) assert.equal(parseLifecycleBrowserBody(body), null)
})

test('gateway authority is supplied only by the trusted session adapter', () => {
  const parsed = parseLifecycleBrowserBody({ companyId: 3, intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } })
  assert.ok(parsed)
  assert.deepEqual(buildGatewayLifecycleRequest(parsed, {
    organizationId: 5,
    actorIdentity: 'session-actor',
    stdbToken: 'session-token',
  }), {
    headers: {
      'x-lumiere-organization-id': '5',
      'x-lumiere-company-id': '3',
      'x-lumiere-actor-identity': 'session-actor',
      'x-lumiere-actor-token': 'session-token',
    },
    body: {
      companyId: 3,
      runId: 7,
      intent: {
        kind: 'resume',
        continuation: { run_id: 7, checkpoint_hash: 'a'.repeat(64), cursor: 4, concurrency_version: 2 },
        idempotency_key: 'resume-1',
      },
    },
  })
})

test('inspect maps to the internal view command without browser authority', () => {
  const parsed = parseLifecycleBrowserBody({ companyId: 3, intent: { kind: 'inspect', runId: 7 } })
  assert.ok(parsed)
  const request = buildGatewayLifecycleRequest(parsed, {
    organizationId: 5,
    actorIdentity: 'actor',
    stdbToken: 'token',
  })
  assert.deepEqual(request.body, { companyId: 3, runId: 7, intent: { kind: 'view' } })
})
