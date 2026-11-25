import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openJournal } from './journal.mjs'
import { claimDevice, deviceEndpoint, gatewayOrigin } from './pairing.mjs'
import { lockState } from './private-store.mjs'
import { createProcessSupervisor } from './provider-process.mjs'

const identity = { runId: 'run-1', attemptId: 'attempt-1', leaseId: 'lease-1' }

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'lumiere-runner-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('journal preserves attempt claims and replays only unacknowledged events on restart', t => {
  const options = { directory: temporaryDirectory(t), deviceId: 'device-1' }
  const journal = openJournal(options)
  assert.equal(journal.claim({ ...identity, prompt: 'Private instructions and credentials' }), true)
  assert.equal(journal.claim(identity), false)
  assert.throws(() => journal.claim({ ...identity, leaseId: 'new-lease' }), /recorded lease/)
  journal.append(identity, { type: 'activity', message: 'Preparing source data' })
  journal.append(identity, { type: 'tool', toolId: 'read-1', name: 'read_stock', status: 'running' })
  journal.acknowledge(identity, 2)

  const reopened = openJournal(options)
  reopened.recoverInterrupted()
  assert.deepEqual(reopened.pending().map(frame => [frame.seq, frame.event.type]), [[1, 'activity'], [3, 'failed']])
  assert.equal(reopened.pending()[1].event.code, 'outcome_unknown')
  assert.equal(reopened.claim(identity), false)
  assert.throws(() => reopened.acknowledge(identity, 4), /unseen/)
  reopened.acknowledge(identity, 1)
  reopened.acknowledge(identity, 3)
  assert.deepEqual(openJournal(options).pending(), [])
  assert.equal(openJournal(options).claim(identity), false)
})

test('journal reserves room for a terminal failure when the event buffer is full', t => {
  const journal = openJournal({
    directory: temporaryDirectory(t), deviceId: 'device-1', maxPendingEvents: 1,
  })
  journal.claim(identity)
  journal.append(identity, { type: 'activity', message: 'Working' })
  assert.throws(() => journal.append(identity, { type: 'candidate', text: 'Answer' }), {
    code: 'runner_capacity',
  })
  journal.append(identity, { type: 'failed', code: 'runner_capacity', message: 'Buffer full' }, { emergency: true })
  assert.deepEqual(journal.pending().map(frame => frame.seq), [1, 2])
})

test('journal only recognizes provider sessions learned on this paired device', t => {
  const directory = temporaryDirectory(t)
  const journal = openJournal({ directory, deviceId: 'device-1' })
  journal.claim({ ...identity, provider: 'codex' })
  journal.append(identity, { type: 'session', nativeSessionId: 'local-session-1' })
  journal.acknowledge(identity, 1)
  const reopened = openJournal({ directory, deviceId: 'device-1' })
  assert.equal(reopened.knowsSession('codex', 'local-session-1'), true)
  assert.equal(reopened.knowsSession('vibe', 'local-session-1'), false)
  assert.equal(openJournal({ directory, deviceId: 'device-2' }).knowsSession('codex', 'local-session-1'), false)
})

test('local state lock excludes concurrent instances and can be acquired after release', async t => {
  const directory = temporaryDirectory(t)
  const unlock = await lockState(directory)
  try {
    await assert.rejects(lockState(directory), /already in use/)
  } finally {
    unlock()
  }
  const reclaim = await lockState(directory)
  reclaim()
})

test('pairing claims through the configured origin without forwarding codes on redirects', async () => {
  assert.throws(() => gatewayOrigin('http://example.com'), /HTTPS/)
  assert.throws(() => gatewayOrigin('https://user:secret@example.com'), /HTTPS/)
  assert.throws(() => gatewayOrigin('https://example.com/proxy'), /HTTPS/)
  assert.equal(deviceEndpoint('https://example.com').href, 'wss://example.com/v1/local-runner/device')
  const pairing = await claimDevice({
    gateway: 'https://example.com',
    code: 'ABCD-1234',
    label: 'Desk Mac',
    async fetch(url, options) {
      assert.equal(url.href, 'https://example.com/v1/local-runner/pair/claim')
      assert.equal(options.redirect, 'error')
      assert.deepEqual(JSON.parse(options.body), { code: 'ABCD-1234', label: 'Desk Mac' })
      return Response.json({ deviceId: 'device-1', credential: 'fixture-token' })
    },
  })
  assert.deepEqual(pairing, {
    gateway: 'https://example.com', deviceId: 'device-1', credential: 'fixture-token',
  })
})

test('provider processes use known binaries, fenced cwd, and precise environment inheritance', async t => {
  const directory = temporaryDirectory(t)
  const supervisor = createProcessSupervisor({
    executables: { codex: process.execPath },
    workDirectory: directory,
    environment: { PATH: '/usr/bin', HOME: directory, OTEL_EXPORTER_OTLP_HEADERS: 'private' },
    graceMs: 50,
  })
  t.after(() => supervisor.close())
  assert.throws(() => supervisor.spawn('sh', []), /locally discovered/)
  assert.throws(() => supervisor.spawn(process.execPath, [], { cwd: tmpdir() }), /outside/)
  assert.throws(() => supervisor.spawn(process.execPath, [], { env: { OTHER: 'secret' } }), /invalid/)

  const child = supervisor.spawn(process.execPath, [
    '-e',
    'console.log(JSON.stringify({cwd:process.cwd(),ambient:process.env.OTEL_EXPORTER_OTLP_HEADERS,mcp:process.env.LUMIERE_MCP_TOKEN}))',
  ], { env: { LUMIERE_MCP_TOKEN: 'scoped-fixture' } })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  await once(child, 'close')
  assert.deepEqual(JSON.parse(output), { cwd: realpathSync(directory), mcp: 'scoped-fixture' })
})

test('provider supervisor aborts a process that ignores normal termination', {
  skip: process.platform === 'win32',
}, async t => {
  const directory = temporaryDirectory(t)
  const supervisor = createProcessSupervisor({
    executables: { codex: process.execPath }, workDirectory: directory, graceMs: 50,
  })
  const controller = new AbortController()
  const child = supervisor.spawn(process.execPath, [
    '-e', 'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000)',
  ], { signal: controller.signal })
  await once(child.stdout, 'data')
  const exit = once(child, 'exit')
  controller.abort()
  await supervisor.close()
  assert.deepEqual(await exit, [null, 'SIGKILL'])
})
