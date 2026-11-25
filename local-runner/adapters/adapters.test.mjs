import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeviceMessage, isRunnerEvent } from '../protocol/v1.mjs'
import { createAdapters } from './index.mjs'

const executable = process.execPath
const fixture = fileURLToPath(new URL('./fixtures/provider.mjs', import.meta.url))
const scopedMcp = { url: 'https://lumiere.example.test/v1/local-runner/mcp', token: 'scoped-fixture-token' }

async function adapterFor(testContext, provider, scenario, isolated = true) {
  const workDirectory = await mkdtemp(join(tmpdir(), 'lumiere-adapter-test-'))
  testContext.after(() => rm(workDirectory, { recursive: true, force: true }))
  return createAdapters({
    executables: { [provider]: executable },
    workDirectory,
    isolatedProviders: isolated ? [provider] : [],
    spawn(command, args, { cwd, signal, env }) {
      return spawn(command, [fixture, provider, scenario, ...args], {
        cwd, stdio: ['pipe', 'pipe', 'pipe'], signal, env: env ?? {}
      })
    }
  })[provider]
}

function turn(adapter, provider, extra = {}, onEvent) {
  const lease = {
    provider, runId: 'run', attemptId: 'attempt', leaseId: 'lease',
    prompt: 'Which product is low on stock?', ...extra
  }
  const events = []
  return adapter.startTurn(lease, {
    signal: AbortSignal.timeout(5000),
    async emit(event) {
      assert.ok(isRunnerEvent(event), JSON.stringify(event))
      events.push(event)
      await onEvent?.(event, lease)
    }
  }).then(() => {
    assert.equal(events.filter(event => ['candidate', 'cancelled', 'failed'].includes(event.type)).length, 1)
    assert.doesNotMatch(JSON.stringify(events), /sensitive|private|scoped-fixture-token/)
    return events
  })
}

for (const provider of ['codex', 'antigravity', 'vibe', 'claude']) {
  test(`${provider} probe and governed prompt conform to the runner contract`, async (testContext) => {
    const adapter = await adapterFor(testContext, provider, 'mcp')
    const status = await adapter.probe()
    assert.ok(isDeviceMessage({ type: 'hello', version: 1, providers: [status] }))
    assert.equal(status.state, 'ready')
    assert.ok(status.capabilities.includes('mcp'))
    assert.doesNotMatch(JSON.stringify(status), /example.test|private/)

    const events = await turn(adapter, provider, { mcp: scopedMcp })
    assert.ok(events.some(event => event.type === 'tool' && event.status === 'running'))
    assert.ok(events.some(event => event.type === 'session' && event.nativeSessionId === 'fixture-session'))
    assert.ok(events.some(event => event.type === 'usage'))
    if (provider === 'codex') {
      assert.deepEqual(events.filter(event => event.type === 'usage').map(({ scope, metric, value }) =>
        [scope, metric, value]), [
        ['account', 'limit_percent', 37],
        ['session', 'input_tokens', 10],
        ['session', 'output_tokens', 8],
        ['session', 'total_tokens', 18],
        ['context', 'context_tokens', 7]
      ])
    }
    assert.deepEqual(events.at(-1), {
      type: 'candidate', text: '{"evidenceId":"fixture-evidence","productIds":["100"]}'
    })
  })
}

test('Codex detects sign-in without starting a model turn', async (testContext) => {
  const adapter = await adapterFor(testContext, 'codex', 'sign-in')
  assert.equal((await adapter.probe()).state, 'signInRequired')
  assert.equal((await turn(adapter, 'codex')).at(-1).code, 'auth_required')
})

test('Codex resumes an exact native session', async (testContext) => {
  const adapter = await adapterFor(testContext, 'codex', 'resume')
  const events = await turn(adapter, 'codex', { nativeSessionId: 'fixture-session' })
  assert.equal(events.at(-1).type, 'candidate')
})

test('a lost Codex turn acknowledgement leaves outcome unknown', async (testContext) => {
  const adapter = await adapterFor(testContext, 'codex', 'disconnect')
  assert.equal((await turn(adapter, 'codex')).at(-1).code, 'outcome_unknown')
})

for (const provider of ['codex', 'antigravity']) {
  test(`${provider} cancellation waits for the native acknowledgement`, async (testContext) => {
    const adapter = await adapterFor(testContext, provider, 'cancel')
    const events = await turn(adapter, provider, {}, async (event, lease) => {
      if (event.type === 'tool') assert.equal(await adapter.cancel(lease), true)
    })
    assert.deepEqual(events.at(-1), { type: 'cancelled' })
  })
}

test('ACP only performs the selected one-time read permission', async (testContext) => {
  const adapter = await adapterFor(testContext, 'antigravity', 'permission')
  const events = await turn(adapter, 'antigravity', {}, async (event, lease) => {
    if (event.type !== 'permission') return
    assert.equal(await adapter.answerPermission({ ...lease, leaseId: 'other' }, event.permissionId, 'approve'), false)
    assert.equal(await adapter.answerPermission(lease, event.permissionId, 'approve'), true)
  })
  assert.ok(events.some(event => event.type === 'permissionResolved'))
  assert.equal(events.at(-1).type, 'candidate')
})

test('ACP cannot silently start a new session when continuation is unsupported', async (testContext) => {
  const adapter = await adapterFor(testContext, 'antigravity', 'no-resume')
  assert.equal((await adapter.probe()).capabilities.includes('resume'), false)
  assert.equal((await turn(adapter, 'antigravity', { nativeSessionId: 'fixture-session' })).at(-1).code, 'unsupported_resume')
})

test('Vibe uses capability-negotiated session loading', async (testContext) => {
  const adapter = await adapterFor(testContext, 'vibe', 'resume')
  assert.equal((await adapter.probe()).capabilities.includes('resume'), true)
  assert.equal((await turn(adapter, 'vibe', { nativeSessionId: 'fixture-session' })).at(-1).type, 'candidate')
})

test('ACP normalizes Vibe quota failures without forwarding native diagnostics', async (testContext) => {
  const adapter = await adapterFor(testContext, 'vibe', 'quota')
  assert.equal((await turn(adapter, 'vibe')).at(-1).code, 'quota_limited')
})

test('detected adapters require verified isolation before a dispatch', async (testContext) => {
  const adapter = await adapterFor(testContext, 'codex', 'mcp', false)
  const status = await adapter.probe()
  assert.equal(status.state, 'unavailable')
  assert.ok(status.version)
  assert.deepEqual(status.capabilities, [])
  assert.equal((await turn(adapter, 'codex', { mcp: scopedMcp })).at(-1).code, 'isolation_required')
})
