import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRailwayDriver, RailwaySandboxProvider, NODE_BOOTSTRAP_COMMAND,
  PINNED_NPM_INSTALL_COMMAND,
} from '../src/provider.mjs';
import {
  createRuntimeProfile, INPUT_PATH, OUTPUT_PATH, RUNNER_COMMAND,
  PRODUCTION_SANDBOX_ADMITTED, NODE_ROOT, NODE_RUNTIME,
} from '../src/profile.mjs';

const runtimeFiles = {
  'package.json': JSON.stringify({ type: 'module', dependencies: { 'quickjs-emscripten': '0.32.0' } }),
  'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { 'quickjs-emscripten': '0.32.0' } },
    'node_modules/quickjs-emscripten': {
      version: '0.32.0', resolved: 'https://registry.npmjs.org/quickjs-emscripten/-/quickjs-emscripten-0.32.0.tgz',
      integrity: 'sha512-YWJj',
    },
  } }),
  'src/runtime/cli.mjs': '/* trusted runner fixture */',
};

function profile(overrides = {}) {
  return createRuntimeProfile({ region: 'eu-west4-drams3a', runtimeFiles, ...overrides });
}

function fixture(options = {}) {
  let now = 1_000;
  const calls = { create: [], connect: [], writes: [], execs: [], reads: [], destroy: 0, refresh: 0 };
  let output = Buffer.from(JSON.stringify({ evidence: [], artifacts: [] }));
  const execution = Promise.resolve(options.result ?? {
    exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false,
  });
  execution.sessionName = Promise.resolve('exec-1');
  execution.kill = async () => {};
  const sandbox = {
    id: 'sandbox-1', environmentId: 'environment-1', status: 'RUNNING',
    region: 'eu-west4-drams3a', networkIsolation: 'ISOLATED',
    domains: [], idleTimeoutMinutes: 5,
    sessions: async () => [],
    files: {
      write: async (...args) => calls.writes.push(args),
      stat: async () => ({ size: output.byteLength, isDir: false }),
      read: async (...args) => { calls.reads.push(args); return output; },
    },
    exec: (...args) => { calls.execs.push(args); return execution; },
    destroy: async () => { calls.destroy += 1; sandbox.status = 'DESTROYED'; },
    refresh: async () => { calls.refresh += 1; return sandbox; },
    ...options.sandbox,
  };
  const driver = {
    create: async (...args) => { calls.create.push(args); return sandbox; },
    connect: async (...args) => { calls.connect.push(args); return sandbox; },
    list: async () => [],
    ...options.driver,
  };
  const provider = new RailwaySandboxProvider({
    token: 'private-controller-token', environmentId: 'environment-1', profile: profile(options.profile),
    clock: () => now, driver,
  });
  return {
    provider, sandbox, driver, calls,
    setNow(value) { now = value; }, setOutput(value) { output = value; },
    async create() {
      return provider.create({ runId: 'run-1', mode: 'synthetic', onCreated: async () => {} });
    },
  };
}

test('profile pins source, lockfile, region and limits in the digest', () => {
  const base = profile();
  assert.equal(base.digest, profile().digest);
  assert.notEqual(base.digest, profile({ region: 'us-west2' }).digest);
  assert.notEqual(base.digest, profile({ cpu: 1 }).digest);
  assert.notEqual(base.digest, profile({ runtimeFiles: { ...runtimeFiles, 'src/runtime/cli.mjs': 'changed' } }).digest);
  assert.ok(Object.isFrozen(base.runtimeFiles));
  assert.deepEqual(base.nodeRuntime, {
    version: '24.19.0', platform: 'linux', arch: 'x64',
    archiveUrl: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz',
    archiveSha256: '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647',
  });
  assert.ok(Object.isFrozen(base.nodeRuntime));
  for (const bad of [undefined, '', 'eu-west; curl evil']) {
    assert.throws(() => profile({ region: bad }), /profile_region_required/);
  }
  assert.throws(() => profile({ runtimeFiles: { ...runtimeFiles, 'src/runtime/../escape.mjs': 'bad' } }), /profile_runtime_file_invalid/);
  assert.throws(() => profile({ maxDurationMs: 0 }), /profile_limits_invalid/);
  assert.throws(() => profile({ idleTimeoutMinutes: 0 }), /profile_limits_invalid/);
  assert.throws(() => profile({ runtimeFiles: { ...runtimeFiles, 'package-lock.json': '{}' } }), /profile_runtime_lock_invalid/);
});

test('production cannot be enabled through mode, environment or a caller certificate', async () => {
  const { provider, calls } = fixture();
  const previous = process.env.LUMIERE_SANDBOX_ENABLED;
  process.env.LUMIERE_SANDBOX_ENABLED = 'true';
  try {
    assert.equal(PRODUCTION_SANDBOX_ADMITTED, false);
    await assert.rejects(provider.create({
      runId: 'run-1', mode: 'production', certificate: { approved: true }, onCreated: async () => {},
    }), /sandbox_certification_required/);
    assert.equal(calls.create.length, 0);
  } finally {
    if (previous === undefined) delete process.env.LUMIERE_SANDBOX_ENABLED;
    else process.env.LUMIERE_SANDBOX_ENABLED = previous;
  }
});

test('durable identity is persisted before materialization or execution', async () => {
  const { provider, calls } = fixture();
  await assert.rejects(provider.create({ runId: 'run-1', mode: 'synthetic' }), /durable_create_callback_required/);
  const handle = await provider.create({ runId: 'run-1', mode: 'synthetic', onCreated: async value => {
    assert.equal(value.id, 'sandbox-1');
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.execs.length, 0);
  } });
  assert.equal(handle.expiresAt, 61_000);
  assert.equal(handle.profileHash, provider.profileHash);
  assert.equal(JSON.stringify(handle).includes('private-controller-token'), false);
});

test('observed placement, networking, domains and idle mismatch are destroyed', async () => {
  for (const mismatch of [
    { region: 'us-west2' }, { networkIsolation: 'PRIVATE' },
    { domains: [{ domain: 'public.example', port: 3000 }] },
    { environmentId: 'other-environment' }, { idleTimeoutMinutes: null },
  ]) {
    const { create, calls } = fixture({ sandbox: mismatch });
    await assert.rejects(create(), /sandbox_create_rejected/);
    assert.equal(calls.destroy, 1);
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.execs.length, 0);
  }
});

test('create transport ambiguity is preserved and never retried', async () => {
  let count = 0;
  const { create } = fixture({ driver: { create: async () => {
    count += 1; throw new Error('provider response with secret');
  } } });
  await assert.rejects(create(), error => {
    assert.equal(error.outcomeUnknown, true);
    assert.equal(error.message, 'sandbox_create_outcome_unknown');
    return true;
  });
  assert.equal(count, 1);
});

test('create deadline retains ambiguity and destroys a late-discovered VM without running input', async () => {
  let resolveCreate;
  const pending = new Promise(resolve => { resolveCreate = resolve; });
  const f = fixture({ profile: { createTimeoutMs: 100 }, driver: { create: () => pending } });
  const persisted = [];
  await assert.rejects(f.provider.create({
    runId: 'run-1', mode: 'synthetic', onCreated: async handle => persisted.push(handle),
  }), error => error.code === 'sandbox_create_outcome_unknown' && error.outcomeUnknown);
  assert.equal(f.calls.destroy, 0);
  resolveCreate(f.sandbox);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, 'sandbox-1');
  assert.equal(f.calls.destroy, 1);
  assert.equal(f.calls.writes.length, 0);
  assert.equal(f.calls.execs.length, 0);
});

test('create deadline destroys a known VM even while journal persistence is stalled', async () => {
  let releaseJournal;
  const pending = new Promise(resolve => { releaseJournal = resolve; });
  const f = fixture({ profile: { createTimeoutMs: 100 } });
  await assert.rejects(f.provider.create({
    runId: 'run-1', mode: 'synthetic', onCreated: () => pending,
  }), error => error.code === 'sandbox_create_outcome_unknown' && error.outcomeUnknown);
  assert.equal(f.calls.destroy, 1);
  releaseJournal();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.destroy, 1);
  assert.equal(f.calls.execs.length, 0);
});

test('journal failure cleans up; cleanup ambiguity remains unknown', async () => {
  const { provider, calls } = fixture();
  await assert.rejects(provider.create({ runId: 'run-1', mode: 'synthetic', onCreated: async () => {
    throw new Error('journal unavailable');
  } }), /sandbox_create_rejected/);
  assert.equal(calls.destroy, 1);
  const second = fixture({ sandbox: { destroy: async () => { throw new Error('offline'); } } });
  await assert.rejects(second.provider.create({ runId: 'run-1', mode: 'synthetic', onCreated: async () => {
    throw new Error('journal unavailable');
  } }), error => error.code === 'sandbox_create_cleanup_unknown' && error.outcomeUnknown);
});

test('program/data use the file plane while exec is a fixed command and no credentials', async () => {
  const f = fixture();
  const handle = await f.create();
  const input = { program: 'throw new Error("`$(curl evil)`")', datasets: [] };
  const persistedSessions = [];
  assert.deepEqual(await f.provider.execute(handle, { input, onSession: async name => persistedSessions.push(name) }), {
    evidence: [], artifacts: [],
  });
  assert.equal(f.calls.writes[0][0], INPUT_PATH);
  assert.deepEqual(JSON.parse(f.calls.writes[0][1].toString()), input);
  assert.deepEqual(f.calls.writes[0][2], { mode: 0o600 });
  assert.equal(f.calls.execs[0][0], RUNNER_COMMAND);
  assert.equal(f.calls.execs[0][0].includes(input.program), false);
  assert.deepEqual(f.calls.execs[0][1].env, {});
  assert.equal(f.calls.execs[0][1].maxOutputBytes, 4096);
  assert.deepEqual(persistedSessions, ['exec-1']);
  assert.equal(f.calls.reads[0][0], OUTPUT_PATH);
  assert.equal(f.calls.reads[0][1].length, 262_145);
});

test('second execution and pre-existing session always require reconciliation', async () => {
  const f = fixture();
  const handle = await f.create();
  await f.provider.execute(handle, { input: {}, onSession: async () => {} });
  await assert.rejects(f.provider.execute(handle, { input: {}, onSession: async () => {} }), /requires_reconciliation/);
  assert.equal(f.calls.execs.length, 1);
  const g = fixture({ sandbox: { sessions: async () => [{ kind: 'EXEC', command: RUNNER_COMMAND, running: false }] } });
  await assert.rejects(g.provider.execute(await g.create(), { input: {}, onSession: async () => {} }), /requires_reconciliation/);
  assert.equal(g.calls.writes.length, 0);
});

test('missing session introspection cannot authorize a new execution', async () => {
  const f = fixture({ sandbox: { sessions: async () => null } });
  await assert.rejects(f.provider.execute(await f.create(), { input: {}, onSession: async () => {} }), /requires_reconciliation/);
  assert.equal(f.calls.execs.length, 0);
});

test('expired handles and oversized input fail before command execution', async () => {
  const f = fixture();
  const handle = await f.create();
  await assert.rejects(f.provider.execute(handle, { input: 'x'.repeat(2_097_153), onSession: async () => {} }), /input_too_large/);
  f.setNow(handle.expiresAt);
  await assert.rejects(f.provider.execute(handle, { input: {}, onSession: async () => {} }), /invalid_or_expired/);
  assert.equal(f.calls.execs.length, 0);
});

test('stdout, stderr, truncation and failed exits never become evidence', async () => {
  for (const result of [
    { stdout: 'sensitive rows' }, { stderr: 'secret diagnostic' },
    { truncated: true }, { exitCode: 1 }, { timedOut: true, exitCode: -1 },
  ]) {
    const f = fixture({ result: { exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, ...result } });
    await assert.rejects(f.provider.execute(await f.create(), { input: {}, onSession: async () => {} }), /sandbox_execution_(failed|timed_out)/);
    assert.equal(f.calls.reads.length, 0);
  }
});

test('unknown termination remains unknown without reading output', async () => {
  const f = fixture({ result: { exitCode: null, stdout: '', stderr: '', truncated: false, timedOut: true } });
  await assert.rejects(f.provider.execute(await f.create(), { input: {}, onSession: async () => {} }), error => {
    return error.code === 'sandbox_execution_outcome_unknown' && error.outcomeUnknown;
  });
  assert.equal(f.calls.reads.length, 0);
});

test('bounded file collection rejects size, concurrent mutation and invalid JSON', async () => {
  for (const bytes of [Buffer.alloc(262_145), Buffer.from('bad JSON'), Buffer.from('[]'), Buffer.from([0xff])]) {
    const f = fixture();
    f.setOutput(bytes);
    await assert.rejects(f.provider.execute(await f.create(), { input: {}, onSession: async () => {} }), /sandbox_output_(invalid|too_large_or_invalid)/);
  }
  const f = fixture();
  f.sandbox.files.stat = async () => ({ size: 1, isDir: false });
  await assert.rejects(f.provider.execute(await f.create(), { input: {}, onSession: async () => {} }), /sandbox_output_too_large_or_invalid/);
});

test('reconciliation recovers only exact durable execution without redispatch', async () => {
  const f = fixture();
  const handle = await f.create();
  const session = { name: 'exec-1', kind: 'EXEC', command: RUNNER_COMMAND, running: true, exitCode: null };
  f.sandbox.sessions = async () => [session];
  assert.deepEqual(await f.provider.reconcile(handle, 'exec-1'), { status: 'running', sessionName: 'exec-1', expired: false });
  f.setNow(handle.expiresAt + 1);
  assert.equal((await f.provider.reconcile(handle, 'exec-1')).expired, true);
  session.running = false;
  session.exitCode = 0;
  assert.deepEqual(await f.provider.reconcile(handle, 'exec-1'), {
    status: 'completed', sessionName: 'exec-1', output: { evidence: [], artifacts: [] },
  });
  assert.deepEqual(await f.provider.reconcile(handle, 'wrong-session'), { status: 'unknown' });
  assert.equal(f.calls.execs.length, 0);
});

test('destroy verifies terminal provider state; no blind success or fleet deletion', async () => {
  const f = fixture();
  const handle = await f.create();
  assert.deepEqual(await f.provider.destroy(handle), { status: 'destroyed' });
  assert.equal(f.calls.refresh, 1);
  const g = fixture({ sandbox: { destroy: async () => {} } });
  await assert.rejects(g.provider.destroy(await g.create()), error => error.code === 'sandbox_cleanup_outcome_unknown' && error.outcomeUnknown);
  const h = fixture({ driver: { list: async () => Array.from({ length: 100 }, (_, i) => ({
    id: `box-${i}`, environmentId: 'environment-1', status: 'RUNNING', region: 'eu-west4-drams3a', createdAt: 'now',
  })) } });
  assert.equal((await h.provider.list()).complete, false);
  assert.equal(h.calls.destroy, 0);
});

test('actual SDK bridge builds a clean pinned template and sets isolated fresh VM options', async () => {
  const calls = { steps: [], build: [], create: [], connect: [], list: [] };
  const template = {
    run(value) { calls.steps.push(value); return this; },
    workdir(value) { assert.equal(value, '/opt/lumiere'); return this; },
    async build(value) { calls.build.push(value); return this; },
  };
  const Sandbox = {
    template: () => template,
    create: async (...args) => { calls.create.push(args); return {}; },
    connect: (...args) => calls.connect.push(args),
    list: (...args) => calls.list.push(args),
  };
  const driver = await createRailwayDriver(Sandbox);
  const auth = { token: 'controller-only', environmentId: 'environment-1' };
  await driver.create(profile(), auth);
  assert.equal(calls.build[0].region, 'eu-west4-drams3a');
  assert.equal(calls.build[0].token, 'controller-only');
  assert.deepEqual(calls.create[0][1], {
    ...auth, region: 'eu-west4-drams3a', networkIsolation: 'ISOLATED', env: {}, domains: [],
    resources: { cpu: 0.5, memoryGB: 0.5 }, idleTimeoutMinutes: 5,
  });
  assert.equal(calls.steps[0], NODE_BOOTSTRAP_COMMAND);
  assert.match(calls.steps[0], /unsupported_runtime_architecture/);
  assert.ok(calls.steps[0].includes(NODE_RUNTIME.archiveUrl));
  assert.ok(calls.steps[0].includes(NODE_RUNTIME.archiveSha256));
  assert.ok(calls.steps[0].includes('node_archive_checksum_mismatch'));
  assert.ok(calls.steps[0].indexOf('node_archive_checksum_mismatch') < calls.steps[0].indexOf('tar -xJf'));
  assert.match(calls.steps[0], /redirect:.*error/);
  assert.match(calls.steps[0], /node_runtime_mismatch/);
  assert.equal(calls.steps.at(-1), PINNED_NPM_INSTALL_COMMAND);
  assert.match(calls.steps.at(-1), /^env -i PATH=\/opt\/lumiere-node\/bin:\/usr\/bin:\/bin /);
  assert.ok(calls.steps.at(-1).includes(`${NODE_ROOT}/bin/node ${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js ci`));
  assert.equal(RUNNER_COMMAND, `${NODE_ROOT}/bin/node /opt/lumiere/src/runtime/cli.mjs`);
  assert.equal(calls.steps.join('\n').includes('controller-only'), false);
  assert.equal(calls.steps.join('\n').includes('DATABASE_URL'), false);
  assert.equal(calls.create[0][0], template);
  driver.connect('box', auth);
  driver.list(auth);
  assert.deepEqual(calls.connect, [['box', auth]]);
  assert.deepEqual(calls.list, [[{ ...auth, first: 100 }]]);
});
