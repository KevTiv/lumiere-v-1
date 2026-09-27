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
    continuation,
    questions: [{ id: 9, key: 'currency', prompt: 'Which currency?', status: 'open', required: true, revision: 1, answer: { secret: 'hidden' } }],
    events: [{ id: 11, kind: 'question_asked', fromVersion: 1, toVersion: 2, cursor: 4, createdAt: '2026-09-19T12:00:00Z', payload: { secret: 'hidden' } }],
    comparison: { leftRunId: 7, rightRunId: 8, leftContinuation: continuation, rightContinuation: { ...continuation, runId: 8 } },
  })

  assert.ok(view)
  assert.equal(view.questions[0]?.answered, true)
  assert.equal('answer' in (view.questions[0] ?? {}), false)
  assert.equal(view.events[0]?.summary, 'Version 1 → 2; cursor 4')
  assert.equal('payload' in (view.events[0] ?? {}), false)
  assert.equal(view.comparison?.rightRunId, 8)
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
