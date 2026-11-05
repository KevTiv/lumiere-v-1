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

const settledEconomics = {
  attemptCount: 4, inputTokens: 6173, outputTokens: 449,
  attemptStatuses: ['succeeded'], reservationStatuses: ['settled'],
  outcomeUnknown: false, truncated: false,
}
const waitingRun = { runId: 8, status: 'agent_settled', stepCount: 5, tokensUsed: 0 }

test('waiting run shows exact complete provider usage instead of the unset run counter', () => {
  assert.equal(mapRunObservation({ ...waitingRun, economics: settledEconomics })?.tokensUsed, 6622)
  assert.equal(mapRunObservation(waitingRun)?.tokensUsed, null)
})

test('unknown, in-flight, malformed or truncated provider usage is not a zero or partial total', () => {
  for (const change of [
    { outcomeUnknown: true },
    { attemptStatuses: ['dispatched'] },
    { attemptStatuses: [] },
    { reservationStatuses: ['reserved'] },
    { reservationStatuses: [] },
    { inputTokens: null },
    { inputTokens: -1 },
    { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
    { truncated: true, attemptCount: null, inputTokens: null, outputTokens: null },
  ]) {
    assert.equal(mapRunObservation({ ...waitingRun, economics: { ...settledEconomics, ...change } })?.tokensUsed, null)
  }
})

test('terminal legacy run retains its recorded counter when no provider summary is present', () => {
  assert.equal(mapRunObservation({ ...waitingRun, status: 'completed', tokensUsed: 321 })?.tokensUsed, 321)
})

const nativeEconomics = {
  ...settledEconomics,
  attemptCount: 1, inputTokens: 0, outputTokens: 0,
  providerModels: [{ provider: 'mistral', model: 'mistral-ocr-2505' }],
  currency: 'USD', settledUnits: 30,
  meteredUsage: {
    totals: [{ unit: 'pages', allowance: 5, actualUnits: 3 }],
    complete: true, truncated: false,
    resultJson: 'private extracted text', actorIdentity: 'private actor',
  },
}

test('OCR pages and embedding tokens remain native usage, with no generation token placeholder', () => {
  for (const unit of ['pages', 'tokens']) {
    const economics = { ...nativeEconomics, meteredUsage: {
      ...nativeEconomics.meteredUsage,
      totals: [{ unit, allowance: 5, actualUnits: 3 }],
    } }
    const view = mapRunObservation({ ...waitingRun, status: 'completed', tokensUsed: null, economics })
    assert.ok(view)
    assert.equal(view.tokensUsed, null)
    assert.equal(view.economics?.inputTokens, null)
    assert.equal(view.economics?.outputTokens, null)
    assert.equal(view.economics?.settledUnits, 30)
    assert.deepEqual(view.economics?.meteredUsage, {
      totals: [{ unit, allowance: 5, actualUnits: 3 }], complete: true, truncated: false,
    })
    assert.ok(!JSON.stringify(view).includes('private'))
  }
})

test('missing native metadata and incomplete or malformed native usage never become zero tokens', () => {
  for (const meteredUsage of [
    undefined,
    { totals: [], complete: false, truncated: false },
    { totals: [{ unit: 'pages', allowance: 5, actualUnits: null }], complete: false, truncated: false },
    { totals: [{ unit: 'pages', allowance: 5, actualUnits: 6 }], complete: true, truncated: false },
    { totals: [{ unit: 'pages', allowance: 5, actualUnits: 3 }], complete: false, truncated: false },
    { totals: [{ unit: 'pages', allowance: null, actualUnits: null }], complete: false, truncated: true },
    { totals: [{ unit: 'requests', allowance: 5, actualUnits: 3 }], complete: true, truncated: false },
  ]) {
    const view = mapRunObservation({
      ...waitingRun, status: 'completed', economics: { ...nativeEconomics, meteredUsage },
    })
    assert.ok(view)
    assert.equal(view.tokensUsed, null)
    assert.equal(view.economics?.inputTokens, null)
    assert.equal(view.economics?.settledUnits, 30)
    assert.equal(view.economics?.meteredUsage?.complete, false)
  }
  // A byte-bounded response may omit optional economics but retains null usage.
  assert.equal(mapRunObservation({ ...waitingRun, status: 'completed', tokensUsed: null })?.tokensUsed, null)
})
