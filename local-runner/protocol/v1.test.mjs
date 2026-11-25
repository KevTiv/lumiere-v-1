import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isDeviceMessage, isGatewayMessage, isRunnerEvent } from './v1.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixture-v1.json', import.meta.url), 'utf8'))

test('accepts the shared runner fixture and keeps run IDs lossless', () => {
  assert.ok(isDeviceMessage(fixture.hello))
  assert.ok(isDeviceMessage(fixture.candidate))
  assert.ok(isGatewayMessage(fixture.dispatch))
  assert.ok(isGatewayMessage(fixture.ack))
  assert.ok(!isGatewayMessage({ ...fixture.dispatch, runId: Number(fixture.dispatch.runId) }))
})

test('rejects a runner claiming to verify its own answer', () => {
  assert.ok(!isDeviceMessage({
    ...fixture.candidate,
    event: { type: 'verified', answer: 'unverified answer' },
  }))
  assert.ok(!isDeviceMessage({ ...fixture.candidate, seq: 0 }))
  assert.ok(!isDeviceMessage({ ...fixture.hello, version: 2 }))
})

test('rejects ambient native process controls and insecure MCP destinations', () => {
  assert.ok(!isGatewayMessage({ ...fixture.dispatch, executable: 'custom' }))
  assert.ok(!isGatewayMessage({ ...fixture.dispatch, cwd: '/tmp' }))
  assert.ok(!isGatewayMessage({ ...fixture.dispatch, env: {} }))
  for (const url of ['http://remote.example/mcp', 'https://user@remote.example/mcp', 'file:///tmp/mcp']) {
    assert.ok(!isGatewayMessage({ ...fixture.dispatch, mcp: { url, token: 'fixture' } }))
  }
  for (const url of ['https://remote.example/mcp', 'http://127.0.0.1:3000/mcp']) {
    assert.ok(isGatewayMessage({ ...fixture.dispatch, mcp: { url, token: 'fixture' } }))
  }
  for (const token of ['fixture token', 'fixture\nsecret', '']) {
    assert.ok(!isGatewayMessage({ ...fixture.dispatch, mcp: { url: 'https://remote.example/mcp', token } }))
  }
})

test('usage keeps quota separate from token counts and estimates', () => {
  const quota = { type: 'usage', scope: 'account', metric: 'limit_percent', value: 40 }
  assert.ok(isRunnerEvent(quota))
  assert.ok(!isRunnerEvent({ ...quota, value: 110 }))
  assert.ok(!isRunnerEvent({ ...quota, scope: 'turn' }))
  assert.ok(!isRunnerEvent({ ...quota, scope: 'turn', metric: 'total_tokens', value: 0.5 }))
  assert.ok(isRunnerEvent({ type: 'usage', scope: 'session', metric: 'cost_usd', value: 0.25, estimated: true }))
})
