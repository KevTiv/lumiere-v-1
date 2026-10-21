import assert from 'node:assert/strict'
import test from 'node:test'

import { mapRunObservation } from './run-observation'

test('maps and orders the bounded redacted run transcript', () => {
  const view = mapRunObservation({
    runId: 7,
    status: 'completed',
    answer: 'private answer',
    errorMessage: 'private provider failure',
    stepCount: 2,
    tokensUsed: 321,
    claims: [{ statement: 'private claim' }],
    transcript: [
      { id: 12, stepNo: 2, toolName: 'inventory.read', inputHash: 'B'.repeat(64), resultSummary: 'untrusted prose', outputRowCount: 4, durationMs: 9, error: false, rawResult: { secret: true } },
      { id: 11, stepNo: 1, toolName: 'catalog.read', inputHash: 'A'.repeat(64), resultSummary: 'leak this', outputRowCount: null, durationMs: 5, error: true, arguments: { secret: true } },
    ],
  })

  assert.ok(view)
  assert.deepEqual(view.transcript.map((step) => step.id), [11, 12])
  assert.equal(view.transcript[0]?.resultSummary, 'tool failed')
  assert.equal(view.transcript[1]?.resultSummary, '4 row(s)')
  assert.equal(view.transcript[1]?.inputHash, 'b'.repeat(64))
  assert.equal('answer' in view, false)
  assert.equal('errorMessage' in view, false)
  assert.equal('claims' in view, false)
  assert.equal('arguments' in (view.transcript[0] ?? {}), false)
  assert.equal('rawResult' in (view.transcript[1] ?? {}), false)
})

test('fails closed on malformed run counters and drops malformed steps', () => {
  assert.equal(mapRunObservation({ runId: 0, stepCount: 0, tokensUsed: 0 }), null)
  assert.equal(mapRunObservation({ runId: 1, stepCount: -1, tokensUsed: 0 }), null)

  const view = mapRunObservation({
    runId: 1,
    status: 'running',
    stepCount: 1,
    tokensUsed: 0,
    transcript: [
      { id: 2, stepNo: 1, toolName: '', inputHash: 'a'.repeat(64), durationMs: 1 },
      { id: 3, stepNo: 1, toolName: 'safe.read', inputHash: 'not-a-hash', durationMs: 1, error: false },
    ],
  })
  assert.ok(view)
  assert.equal(view.transcript.length, 1)
  assert.equal(view.transcript[0]?.inputHash, null)
})

test('deduplicates transcript ids before sorting', () => {
  const view = mapRunObservation({
    runId: 1,
    status: 'running',
    stepCount: 2,
    tokensUsed: 0,
    transcript: [
      { id: 4, stepNo: 2, toolName: 'first', inputHash: 'a'.repeat(64), durationMs: 1 },
      { id: 4, stepNo: 1, toolName: 'duplicate', inputHash: 'b'.repeat(64), durationMs: 1 },
    ],
  })
  assert.ok(view)
  assert.deepEqual(view.transcript.map((step) => step.toolName), ['first'])
})
