import assert from 'node:assert/strict'
import test from 'node:test'

import { mapRunHistory, runHistoryRequest } from './run-history'

const cursor = 'AAAAAAAAACo'

test('maps bounded history and economics without retaining private run fields', () => {
  const view = mapRunHistory({
    runs: [{
      runId: 42,
      status: 'completed',
      skillId: 3,
      agentId: 4,
      stepCount: 2,
      tokensUsed: 120,
      startedAt: '2026-10-13T10:00:00Z',
      completedAt: '2026-10-13T10:01:00Z',
      answer: 'private',
      errorMessage: 'private',
      economics: {
        providerModels: [{ provider: 'openai', model: 'gpt-test' }],
        providerModelsTruncated: true,
        attemptCount: 1,
        attemptStatuses: ['abandoned'],
        reservationStatuses: ['released'],
        outcomeUnknown: false,
        inputTokens: 100,
        outputTokens: 20,
        currency: 'USD',
        reservedUnits: 50,
        settledUnits: 30,
        truncated: false,
      },
    }],
    nextCursor: cursor,
  })
  assert.ok(view)
  assert.equal(view.nextCursor, cursor)
  assert.equal(view.runs[0]?.economics?.settledUnits, 30)
  assert.equal(view.runs[0]?.economics?.providerModelsTruncated, true)
  assert.deepEqual(view.runs[0]?.economics?.attemptStatuses, ['abandoned'])
  assert.deepEqual(view.runs[0]?.economics?.reservationStatuses, ['released'])
  assert.equal('answer' in (view.runs[0] ?? {}), false)
  assert.equal('errorMessage' in (view.runs[0] ?? {}), false)
})

test('rejects malformed cursors and drops malformed rows', () => {
  assert.equal(mapRunHistory({ runs: [], nextCursor: '42' }), null)
  const view = mapRunHistory({
    runs: [
      { runId: 0, status: 'completed', skillId: 1, agentId: 1, stepCount: 0, tokensUsed: 0, startedAt: 'now' },
      { runId: 1, status: 'completed', skillId: 1, agentId: 1, stepCount: 0, tokensUsed: 0, startedAt: 'now' },
    ],
    nextCursor: null,
  })
  assert.ok(view)
  assert.deepEqual(view.runs.map((run) => run.runId), [1])
})

test('browser history request contains no authority', () => {
  const request = runHistoryRequest(9, cursor)
  assert.deepEqual(request, { companyId: 9, cursor, limit: 20 })
  assert.equal('organizationId' in request, false)
  assert.equal('actorIdentity' in request, false)
})
