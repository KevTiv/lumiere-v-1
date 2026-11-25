import assert from 'node:assert/strict'
import test from 'node:test'
import { localRunnerOperation } from '../app/api/ai/local-runner/contract'
import { assistantHistoryResult, localRunnerAnswer } from './assistant-turn'
import { followRunnerTurn, issueRunnerPairing, startRunnerTurn } from './local-runner-client'
import { applyRunnerEvent, initialRunnerActivity, parseRunnerDiscovery, type RunnerEvent } from './local-runner-state'

const companyId = 4097
const input = { companyId, conversationId: 'chat-1', requestId: 'turn-1', deviceId: 'device-1', provider: 'codex' as const, prompt: 'Why is stock low?' }
const run = { runId: 'run-1', attemptId: 'attempt-1' }
const signal = () => new AbortController().signal
const sse = (...events: Record<string, unknown>[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
  { headers: { 'Content-Type': 'text/event-stream' } })

test('the runner is opt-in and an unqualified device cannot alter the managed agent list', () => {
  const device = { deviceId: 'test-device', label: 'Mac', state: 'online', providers: [
    { provider: 'codex', state: 'ready', capabilities: ['mcp', 'usage'], funding: 'subscription' },
  ] }
  assert.deepEqual(parseRunnerDiscovery({ version: 1, enabled: false, devices: [device] }), { enabled: false, devices: [] })
  assert.deepEqual(parseRunnerDiscovery({ version: 1, enabled: true, devices: [device] }), { enabled: true, devices: [device] })
  assert.equal(parseRunnerDiscovery({ version: 2, enabled: true, devices: [device] }), undefined)
  assert.equal(parseRunnerDiscovery({ version: 1, enabled: true, devices: [device, device] }), undefined)
})

test('browser runner operations forward only typed intent and constrain the upstream path', () => {
  assert.deepEqual(localRunnerOperation('POST', ['runs'], { ...input, executable: 'untrusted', actorToken: 'spoof' }), {
    companyId, path: 'runs', body: input,
  })
  assert.equal(localRunnerOperation('POST', ['runs'], { ...input, requestId: '' }), undefined)
  assert.equal(localRunnerOperation('POST', ['runs'], { ...input, companyId: 0 }), undefined)
  assert.equal(localRunnerOperation('POST', ['runs', '../other', 'cancel'], { companyId }), undefined)
  assert.equal(localRunnerOperation('POST', ['runs', 'run-1', 'permission'], { companyId, permissionId: 'p-1', decision: 'approve-erp' }), undefined)
  assert.deepEqual(localRunnerOperation('GET', ['runs', 'run:1.v1', 'events'], { companyId, after: '4' }), {
    companyId, path: 'runs/run%3A1.v1/events?companyId=4097&after=4', stream: true,
  })
})

test('pairing accepts the runner UUID and retains the public gateway origin', async (t) => {
  const pair = { code: '76ff1124-353a-4c02-8ab8-c5345a2b49b7', expiresAt: '2028-01-01T00:00:00Z', gatewayOrigin: 'https://runner.example' }
  t.mock.method(globalThis, 'fetch', async () => Response.json(pair))
  assert.deepEqual(await issueRunnerPairing(companyId), pair)
})

test('a broken activity stream attaches at its cursor without a second POST', async (t) => {
  const calls: string[] = []
  const first = { seq: 1, type: 'activity', message: 'Reading stock' }
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), input)
      return Response.json(run)
    }
    if (url.endsWith('after=0')) return sse(first)
    return sse(first, { seq: 2, type: 'usage', scope: 'turn', metric: 'total_tokens', value: 128 },
      { seq: 3, type: 'verified', answer: 'The item is below its reorder level.' })
  })
  const started = await startRunnerTurn(input, signal())
  const checkpoints: [number, boolean][] = []
  const result = await followRunnerTurn(companyId, started, signal(), (state, reconnecting) => checkpoints.push([state.cursor, reconnecting]))
  assert.equal(result?.type, 'verified')
  assert.deepEqual(calls, [
    'POST /api/ai/local-runner/runs',
    'GET /api/ai/local-runner/runs/run-1/events?companyId=4097&after=0',
    'GET /api/ai/local-runner/runs/run-1/events?companyId=4097&after=1',
  ])
  assert.equal(fetchMock.mock.callCount(), 3)
  assert.ok(checkpoints.some(([cursor, reconnecting]) => cursor === 1 && reconnecting))
})

test('an ambiguous dispatch failure is not retried', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }))
  await assert.rejects(startRunnerTurn(input, signal()), /outcome is unknown/)
  assert.equal(request.mock.callCount(), 1)
})

test('raw candidates and non-contiguous events fail closed', async (t) => {
  const response = sse({ seq: 1, type: 'candidate', text: 'Unverified text' }, { seq: 2, type: 'verified', answer: 'admitted' })
  t.mock.method(globalThis, 'fetch', async () => response)
  const published: unknown[] = []
  await assert.rejects(followRunnerTurn(companyId, run, signal(), state => published.push(state)), /Invalid local runner activity/)
  assert.equal(published.length, 0)
  assert.throws(() => applyRunnerEvent(initialRunnerActivity(), { seq: 2, type: 'verified', answer: 'unconfirmed' }), /sequence/)
})

test('verified runner evidence survives the same stream parser and history projection used by chat', async (t) => {
  const evidenceId = 'c63c8d76-2bce-41f4-a72c-55015f356b82'
  const source = {
    kind: 'live', trust: 'authoritative', entity_type: 'product', entity_id: '42',
    text_snippet: 'Product #42 has 4 units on hand.',
  }
  const reply = { seq: 1, type: 'verified', answer: 'Low stock verified.', run_id: 41, sources: [source] }
  const fetch = t.mock.method(globalThis, 'fetch', async () => sse({ ...reply, evidence_id: evidenceId }))
  const result = await followRunnerTurn(companyId, run, signal(), () => {})
  assert.equal(result?.type, 'verified')
  const answer = localRunnerAnswer(result)
  assert.deepEqual(answer.sources, [source])
  assert.equal(answer.run_id, 41)
  assert.equal(JSON.parse(assistantHistoryResult(answer.verification, null).metadata!).answerVerification.evidenceId, evidenceId)

  fetch.mock.mockImplementation(async () => sse({ ...reply, evidence_id: 'invalid' }))
  await assert.rejects(followRunnerTurn(companyId, run, signal(), () => {}), /Invalid local runner activity/)
})

test('runtime permissions and scoped usage update without an ERP effect or an invented charge', () => {
  const events: RunnerEvent[] = [
    { seq: 1, type: 'permission', permissionId: 'p-1', label: 'Read stock scope' },
    { seq: 2, type: 'usage', scope: 'turn', metric: 'total_tokens', value: 128 },
    { seq: 3, type: 'usage', scope: 'context', metric: 'context_tokens', value: 3000 },
    { seq: 4, type: 'permissionResolved', permissionId: 'p-1' },
    { seq: 5, type: 'usage', scope: 'turn', metric: 'total_tokens', value: 256 },
    { seq: 6, type: 'cancelled' },
  ]
  const state = events.reduce(applyRunnerEvent, initialRunnerActivity())
  assert.deepEqual(state.permissions, [])
  assert.deepEqual(state.usage.map(({ scope, metric, value }) => [scope, metric, value]), [
    ['turn', 'total_tokens', 256], ['context', 'context_tokens', 3000],
  ])
  assert.equal(state.terminal?.type, 'cancelled')
})
