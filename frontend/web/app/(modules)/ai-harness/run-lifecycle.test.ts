import assert from 'node:assert/strict'
import test from 'node:test'

import { lifecycleRequest, mapContinuation, mapRunLifecycle } from './run-lifecycle'

const continuation = {
  runId: 7,
  checkpointHash: 'a'.repeat(64),
  cursor: 3,
  concurrencyVersion: 2,
}

test('maps bounded lifecycle state without exposing answer bodies', () => {
  const view = mapRunLifecycle({
    runId: 7,
    state: 'waiting_input',
    truncated: true,
    continuation,
    questions: [{ id: 9, key: 'currency', prompt: 'Which currency?', status: 'open', required: true, revision: 1, answer: { secret: 'hidden' } }],
    events: [{ id: 11, kind: 'question_asked', fromVersion: 1, toVersion: 2, cursor: 4, createdAt: '2026-09-19T12:00:00Z', payload: { secret: 'hidden' } }],
    comparison: {
      leftRunId: 7,
      rightRunId: 8,
      leftContinuation: continuation,
      rightContinuation: { ...continuation, runId: 8 },
      details: {
        leftStatus: 'completed',
        rightStatus: 'failed',
        leftStepCount: 3,
        rightStepCount: 4,
        leftTokensUsed: 100,
        rightTokensUsed: 120,
        toolsOnlyLeft: ['inventory.read'],
        toolsOnlyRight: ['catalog.read'],
        toolDiffTruncated: false,
      },
    },
  })

  assert.ok(view)
  assert.equal(view.questions[0]?.answered, true)
  assert.equal(view.truncated, true)
  assert.equal('answer' in (view.questions[0] ?? {}), false)
  assert.equal(view.events[0]?.summary, 'Version 1 → 2; cursor 4')
  assert.equal('payload' in (view.events[0] ?? {}), false)
  assert.equal(view.comparison?.rightRunId, 8)
  assert.deepEqual(view.comparison?.details?.toolsOnlyLeft, ['inventory.read'])
  assert.equal(view.comparison?.details?.rightTokensUsed, 120)
})

test('continuations fail closed on malformed lineage or concurrency', () => {
  assert.deepEqual(mapContinuation(continuation), continuation)
  assert.equal(mapContinuation({ ...continuation, checkpointHash: 'forged' }), null)
  assert.equal(mapContinuation({ ...continuation, concurrencyVersion: 0 }), null)
  assert.equal(mapRunLifecycle({ runId: 7, state: 'running', continuation: { ...continuation, cursor: -1 } }), null)
})

test('browser request contains company intent but no authority fields', () => {
  const request = lifecycleRequest(4, { kind: 'resume', continuation, idempotencyKey: 'resume-1' })
  assert.deepEqual(request, { companyId: 4, intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } })
  assert.equal('organizationId' in request, false)
  assert.equal('actorIdentity' in request, false)
  assert.equal('token' in request, false)
})


test('metadata-only questions cannot become reply choices or expose authored content', () => {
  const view = mapRunLifecycle({ runId: 8, state: 'waiting_input', questions: [
    { id: 1, key: 'q1', revision: 2, status: 'answered', answered: true },
  ] })
  assert.ok(view)
  assert.equal(view.questions[0]?.contentAvailable, false)
  assert.equal(view.questions[0]?.prompt, '')
  assert.equal(view.questions[0]?.answered, true)
})
