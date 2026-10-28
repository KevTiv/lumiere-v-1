import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { AuthorityError, createActorAuthorizer } from '../src/authority.mjs';

const GENERATION = { placementGeneration: 3, policySnapshotHash: 'sha256:policy1', capabilityGrantsHash: 'sha256:grants1' };
const SCOPE = Object.freeze({ actorIdentity: 'actor-1', organizationId: '1', companyId: '2', runId: '3',
  policyGeneration: createHash('sha256').update(JSON.stringify(GENERATION)).digest('hex') });
const TOKEN = 'synthetic-actor-token';
const CAPABILITY = 'finance.balance.read';
const envelope = (overrides = {}) => ({ organizationId: 1, companyId: 2, actorIdentity: 'actor-1', knowledgeTeamRefs: [],
  ...GENERATION, grants: [{ capabilityKey: CAPABILITY, maxRows: 1_000, maxBytes: 65_536 }], ...overrides });
const request = (overrides = {}) => ({ scope: SCOPE, operation: 'materialize', handleIds: ['ds_abc'], ...overrides });

async function fixture(t, handler, options = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ url: req.url, authorization: req.headers.authorization, identity: req.headers['x-stdb-identity'] });
    handler(req, res, calls.length);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const apiBaseUrl = `http://127.0.0.1:${server.address().port}`;
  const authorize = createActorAuthorizer({ apiBaseUrl, actorToken: TOKEN, scope: SCOPE,
    requiredCapabilities: [CAPABILITY], ...options });
  return { authorize, calls, apiBaseUrl };
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

test('actual API request uses actor credentials, fixed path and company selection on every boundary', async (t) => {
  const f = await fixture(t, (_req, res) => json(res, envelope()));
  for (const operation of ['issue', 'materialize', 'export', 'revoke', 'execute', 'inspect', 'cancel']) {
    assert.equal(await f.authorize(request({ operation })), true);
  }
  assert.equal(f.calls.length, 7);
  for (const call of f.calls) {
    assert.equal(call.url, '/v1/ai/capability-grants?companyId=2');
    assert.equal(call.authorization, `Bearer ${TOKEN}`);
    assert.equal(call.identity, 'actor-1');
  }
  assert.equal(JSON.stringify(f.authorize), undefined);
  assert.doesNotMatch(f.authorize.toString(), /synthetic-actor-token/);
});

test('current actor/company/org and all generation changes deny without broadening scope', async (t) => {
  let current = envelope();
  const f = await fixture(t, (_req, res) => json(res, current));
  assert.equal(await f.authorize(request()), true);
  for (const change of [{ organizationId: 10 }, { companyId: 10 }, { actorIdentity: 'actor-2' },
    { placementGeneration: 4 }, { policySnapshotHash: 'sha256:policy2' }, { capabilityGrantsHash: 'sha256:grants2' }]) {
    current = envelope(change);
    assert.equal(await f.authorize(request()), false);
  }
});

test('revoked, empty, zero, unsafe and malformed current grants deny', async (t) => {
  let current = envelope();
  const f = await fixture(t, (_req, res) => json(res, current));
  const bad = [[], [{ capabilityKey: 'other.read', maxRows: 10, maxBytes: 100 }],
    [{ capabilityKey: CAPABILITY, maxRows: 0, maxBytes: 100 }],
    [{ capabilityKey: CAPABILITY, maxRows: 10, maxBytes: 0 }],
    [{ capabilityKey: CAPABILITY, maxRows: 10, maxBytes: 9_007_199_254_740_992 }],
    [{ capabilityKey: CAPABILITY, maxRows: '10', maxBytes: 100 }],
    [{ capabilityKey: CAPABILITY, maxRows: 10, maxBytes: 100, sql: 'SELECT *' }]];
  for (const grants of bad) {
    current = envelope({ grants });
    assert.equal(await f.authorize(request()), false);
  }
  current = envelope({ grants: [
    { capabilityKey: CAPABILITY, maxRows: 100, maxBytes: 1_000 },
    { capabilityKey: CAPABILITY, maxRows: 10, maxBytes: 100 },
  ] });
  assert.equal(await f.authorize(request()), true);
});

test('unsafe numeric API identity cannot match a rounded caller identity', async (t) => {
  const highScope = { ...SCOPE, organizationId: '9007199254740992' };
  const f = await fixture(t, (_req, res) => json(res, envelope({ organizationId: 9_007_199_254_740_992 })), { scope: highScope });
  assert.equal(await f.authorize(request({ scope: highScope })), false);
});

test('canonical string API identities preserve full u64 scope without rounding', async (t) => {
  const highScope = { ...SCOPE, organizationId: '18446744073709551615' };
  const f = await fixture(t, (_req, res) => json(res, envelope({ organizationId: highScope.organizationId })), { scope: highScope });
  assert.equal(await f.authorize(request({ scope: highScope })), true);
});

test('changed callback scope or unsupported operation denies before any network request', async (t) => {
  const f = await fixture(t, (_req, res) => json(res, envelope()));
  for (const key of Object.keys(SCOPE)) {
    const value = key === 'policyGeneration' ? 'a'.repeat(64) : key === 'actorIdentity' ? 'actor-2' : '10';
    assert.equal(await f.authorize(request({ scope: { ...SCOPE, [key]: value } })), false);
  }
  assert.equal(await f.authorize(request({ operation: 'rawSql' })), false);
  assert.equal(f.calls.length, 0);
});

test('redirect is denied and actor credentials never reach the redirect target', async (t) => {
  let targetCalls = 0;
  const target = await fixture(t, (_req, res) => { targetCalls += 1; json(res, envelope()); });
  const redirect = await fixture(t, (_req, res) => {
    res.writeHead(302, { location: `${target.apiBaseUrl}/v1/ai/capability-grants` });
    res.end();
  });
  assert.equal(await redirect.authorize(request()), false);
  assert.equal(targetCalls, 0);
});

test('API status, non-JSON, oversized content-length and streamed body are bounded denials', async (t) => {
  let mode = 'status';
  const f = await fixture(t, (_req, res) => {
    if (mode === 'status') return json(res, { error: 'private-source-data' }, 403);
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('private-source-data'); }
    if (mode === 'length') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '200000' }); return res.end('{}'); }
    if (mode === 'stream') { res.writeHead(200, { 'content-type': 'application/json' }); res.write(' '.repeat(100_000)); return res.end(' '.repeat(100_000)); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{invalid-json-private-source-data');
  });
  for (mode of ['status', 'html', 'length', 'stream', 'json']) assert.equal(await f.authorize(request()), false);
});

test('request and body-read deadlines stop a hanging authority API', async (t) => {
  let mode = 'headers';
  const f = await fixture(t, (_req, res) => {
    if (mode === 'body') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }
  }, { timeoutMs: 30 });
  let started = Date.now();
  assert.equal(await f.authorize(request()), false);
  assert.ok(Date.now() - started < 1_000);
  mode = 'body';
  started = Date.now();
  assert.equal(await f.authorize(request()), false);
  assert.ok(Date.now() - started < 1_000);
});

test('constructor permits only trusted HTTPS or loopback/Railway-internal HTTP origins', () => {
  const config = { apiBaseUrl: 'https://api.example.invalid', actorToken: TOKEN, scope: SCOPE, requiredCapabilities: [CAPABILITY] };
  for (const apiBaseUrl of ['https://api.example.invalid', 'http://127.0.0.1:8080', 'http://localhost:8080',
    'http://[::1]:8080', 'http://api-server.railway.internal:8080']) {
    assert.equal(typeof createActorAuthorizer({ ...config, apiBaseUrl }), 'function');
  }
  for (const apiBaseUrl of ['http://api.example.invalid', 'http://localhost.evil.invalid', 'file:///tmp/secret',
    'https://user:secret@api.example.invalid', 'https://api.example.invalid?token=secret',
    'https://api.example.invalid/#secret', 'https://api.example.invalid/arbitrary']) {
    assert.throws(() => createActorAuthorizer({ ...config, apiBaseUrl }), AuthorityError);
  }
  for (const change of [{ requiredCapabilities: [] }, { requiredCapabilities: [CAPABILITY, CAPABILITY] },
    { requiredCapabilities: ['https://arbitrary.invalid'] }, { actorToken: 'token\r\ninjected' },
    { timeoutMs: 10_001 }, { scope: { ...SCOPE, organizationId: 1 } }]) {
    assert.throws(() => createActorAuthorizer({ ...config, ...change }), AuthorityError);
  }
});
