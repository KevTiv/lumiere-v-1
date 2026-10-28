import assert from 'node:assert/strict';
import test from 'node:test';
import { BrokerError, DatasetBroker } from '../src/broker.mjs';

const START = Date.parse('2026-10-28T12:00:00.000Z');
const SCOPE = Object.freeze({
  actorIdentity: 'actor-1', organizationId: '18446744073709551615',
  companyId: '2', runId: '3', policyGeneration: 'policy-1',
});
const SCHEMA = Object.freeze({
  ref: 'finance-balances-v1', fields: [{ name: 'amount', type: 'number' }, { name: 'name', type: 'string' }],
});
const ROWS = [{ amount: 10, name: 'private A' }, { amount: 20, name: 'private B' }, { amount: 30, name: 'private C' }];

function fixture(options = {}) {
  let now = START;
  let permitted = true;
  const rows = new Map();
  const authorization = [];
  const store = {
    putDataset(record) { rows.set(record.id, structuredClone(record)); },
    getDataset(id) { return structuredClone(rows.get(id)); },
    revokeDataset(id) { rows.get(id).revoked = true; },
  };
  const broker = new DatasetBroker({
    store,
    clock: () => now,
    authorize: async (request) => { authorization.push(structuredClone(request)); return permitted; },
    ...options,
  });
  const issue = (overrides = {}) => broker.issue({
    scope: SCOPE, schema: SCHEMA, rows: ROWS,
    expiresAt: new Date(START + 60_000).toISOString(),
    sourceCapabilities: ['finance.balance.read'], watermark: 'commit:42', provenanceRef: 'run:3:read:1',
    ...overrides,
  });
  return { broker, issue, rows, authorization, setTime(value) { now = value; }, deny() { permitted = false; } };
}

const outputFor = (id) => ({
  evidence: [{ kind: 'aggregate', value: { label: 'total', value: 60, count: 3 }, sourceDatasets: [id] }],
  artifacts: [],
});
const denies = (code) => (error) => error instanceof BrokerError && error.code === code;

test('opaque handle metadata excludes every raw row, scope and storage detail', async () => {
  const f = fixture();
  const handle = await f.issue();
  assert.match(handle.id, /^ds_[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(handle).sort(), ['expiresAt', 'id', 'provenanceRef', 'rowCount', 'schemaRef', 'sourceCapabilities', 'watermark'].sort());
  assert.equal(handle.rowCount, 3);
  assert.doesNotMatch(JSON.stringify(handle), /private|actor-1|18446744073709551615|amount/);
  const second = await f.issue();
  assert.notEqual(handle.id, second.id);
  assert.deepEqual(await f.broker.materialize({ scope: SCOPE, handleIds: [handle.id] }), [{ id: handle.id, rows: ROWS }]);
});

test('current authorization is required for issue, materialization and export', async () => {
  const f = fixture();
  const handle = await f.issue();
  await f.broker.materialize({ scope: SCOPE, handleIds: [handle.id] });
  await f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: outputFor(handle.id) });
  assert.deepEqual(f.authorization.map((call) => call.operation), ['issue', 'materialize', 'export']);
  f.deny();
  await assert.rejects(f.issue(), denies('authorization_denied'));
  await assert.rejects(f.broker.materialize({ scope: SCOPE, handleIds: [handle.id] }), denies('authorization_denied'));
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: outputFor(handle.id) }), denies('authorization_denied'));
  assert.equal(f.rows.size, 1);
});

test('authorization callback is mandatory and only an explicit true admits', async () => {
  assert.throws(() => new DatasetBroker({ store: {} }), denies('missing_trusted_dependency'));
  for (const result of [undefined, null, { allowed: true }, 'true', 1]) {
    const f = fixture({ authorize: async () => result });
    await assert.rejects(f.issue(), denies('authorization_denied'));
  }
});

test('every actor, organization, company, run and policy binding is checked', async () => {
  const f = fixture();
  const handle = await f.issue();
  for (const key of Object.keys(SCOPE)) {
    const scope = { ...SCOPE, [key]: key === 'actorIdentity' ? 'actor-2' : key === 'policyGeneration' ? 'policy-2' : '10' };
    await assert.rejects(f.broker.materialize({ scope, handleIds: [handle.id] }), denies('handle_scope_mismatch'));
    await assert.rejects(f.broker.validateOutput({ scope, handleIds: [handle.id], output: outputFor(handle.id) }), denies('handle_scope_mismatch'));
    await assert.rejects(f.broker.revoke({ scope, handleId: handle.id }), denies('handle_scope_mismatch'));
  }
  for (const organizationId of [1, '01', '0', '-1', '18446744073709551616']) {
    await assert.rejects(f.issue({ scope: { ...SCOPE, organizationId } }), denies('invalid_scope'));
  }
});

test('expiry and revocation invalidate materialization and output export', async () => {
  const f = fixture();
  const handle = await f.issue();
  f.setTime(START + 60_000);
  await assert.rejects(f.broker.materialize({ scope: SCOPE, handleIds: [handle.id] }), denies('expired_handle'));
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: outputFor(handle.id) }), denies('expired_handle'));
  // The owner can explicitly revoke an expired record for cleanup.
  await f.broker.revoke({ scope: SCOPE, handleId: handle.id });
  assert.equal(f.rows.get(handle.id).revoked, true);
  const g = fixture();
  const active = await g.issue();
  await g.broker.revoke({ scope: SCOPE, handleId: active.id });
  await assert.rejects(g.broker.materialize({ scope: SCOPE, handleIds: [active.id] }), denies('revoked_handle'));
});

test('expiry or revocation during authorization is checked again', async () => {
  const records = new Map();
  const store = {
    putDataset(record) { records.set(record.id, record); },
    getDataset(id) { return records.get(id); },
    revokeDataset(id) { records.get(id).revoked = true; },
  };
  const f = fixture({ store, authorize: async ({ operation, handleIds }) => {
    if (operation === 'materialize') store.revokeDataset(handleIds[0]);
    return true;
  } });
  const handle = await f.issue();
  await assert.rejects(f.broker.materialize({ scope: SCOPE, handleIds: [handle.id] }), denies('revoked_handle'));
});

test('issuer cannot widen configured row, byte, TTL or schema ceilings', async () => {
  const f = fixture({ limits: { maxRows: 2 } });
  await assert.rejects(f.issue({ limits: { maxRows: 1_000_000 } }), denies('row_limit'));
  const g = fixture({ limits: { maxBytes: 50 } });
  await assert.rejects(g.issue({ limits: { maxBytes: 1_000_000 } }), denies('byte_limit'));
  const h = fixture();
  await assert.rejects(h.issue({ expiresAt: new Date(START + 900_001).toISOString() }), denies('invalid_expiry'));
  await assert.rejects(h.issue({ expiresAt: '2026-10-28T12:01:00Z' }), denies('invalid_expiry'));
  await assert.rejects(h.issue({ limits: { timeoutMs: 10 } }), denies('invalid_fields'));
  await assert.rejects(h.issue({ rows: [{ amount: '10', name: 'private A' }] }), denies('row_schema_mismatch'));
  await assert.rejects(h.issue({ rows: [{ amount: 10, name: 'private A', password: 'secret' }] }), denies('invalid_fields'));
  await assert.rejects(h.issue({ rows: [{ amount: NaN, name: 'private A' }] }), denies('non_json_value'));
  await assert.rejects(h.issue({ rows: [{ amount: 9_007_199_254_740_992, name: 'private A' }] }), denies('non_json_value'));
  await assert.rejects(h.issue({ schema: { ...SCHEMA, sql: 'SELECT * FROM users' } }), denies('invalid_fields'));
  await assert.rejects(h.issue({ schema: { ...SCHEMA, ref: 'https://database.invalid' } }), denies('invalid_reference'));
});

test('persisted data corruption and policy changes fail closed', async () => {
  const f = fixture();
  const handle = await f.issue();
  f.rows.get(handle.id).rows[0].amount = 900;
  await assert.rejects(f.broker.materialize({ scope: SCOPE, handleIds: [handle.id] }), denies('dataset_integrity'));
  const g = fixture();
  const other = await g.issue();
  g.rows.get(other.id).policyHash = 'bad';
  await assert.rejects(g.broker.materialize({ scope: SCOPE, handleIds: [other.id] }), denies('disclosure_policy_changed'));
  for (const [key, value, code] of [['expiresAt', 'invalid-date', 'dataset_integrity'], ['revoked', null, 'dataset_integrity'], ['limits', {}, 'invalid_fields']]) {
    const h = fixture();
    const stored = await h.issue();
    h.rows.get(stored.id)[key] = value;
    await assert.rejects(h.broker.materialize({ scope: SCOPE, handleIds: [stored.id] }), denies(code));
  }
});

test('numeric aggregate, summary and bounded table retain exact admitted lineage', async () => {
  const f = fixture();
  const handle = await f.issue();
  const output = {
    evidence: [
      ...outputFor(handle.id).evidence,
      { kind: 'summary', value: { metrics: [{ label: 'average', value: 20, count: 3 }] }, sourceDatasets: [handle.id] },
      { kind: 'table', value: { columns: ['total', 'average'], rows: [{ values: [60, 20], count: 3 }] }, sourceDatasets: [handle.id] },
    ],
    artifacts: [],
  };
  assert.deepEqual(await f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output }), output);
});

test('raw rows, textual evidence, low-cardinality groups and unapproved labels are denied', async () => {
  const f = fixture();
  const handle = await f.issue();
  const bad = [
    [{ kind: 'raw', value: ROWS, sourceDatasets: [handle.id] }, 'disclosure_kind_denied'],
    [{ kind: 'aggregate', value: { label: 'total', value: 'private A', count: 3 }, sourceDatasets: [handle.id] }, 'invalid_metric'],
    [{ kind: 'aggregate', value: { label: 'private A', value: 10, count: 3 }, sourceDatasets: [handle.id] }, 'disclosure_label_denied'],
    [{ kind: 'aggregate', value: { label: 'total', value: 10, count: 1 }, sourceDatasets: [handle.id] }, 'disclosure_group_denied'],
    [{ kind: 'aggregate', value: { label: 'total', value: 10, count: 999 }, sourceDatasets: [handle.id] }, 'disclosure_group_denied'],
    [{ kind: 'table', value: { columns: ['total'], rows: [{ values: ['private A'], count: 3 }] }, sourceDatasets: [handle.id] }, 'invalid_table'],
    [{ kind: 'aggregate', value: { label: 'total', value: 60, count: 3, debug: ROWS }, sourceDatasets: [handle.id] }, 'invalid_fields'],
  ];
  for (const [evidence, code] of bad) {
    await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: { evidence: [evidence], artifacts: [] } }), denies(code));
  }
  const output = outputFor(handle.id);
  output.stdout = 'private A';
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output }), denies('invalid_fields'));
});

test('lineage cannot select unadmitted, duplicate, empty or foreign handles', async () => {
  const f = fixture();
  const handle = await f.issue();
  const other = await f.issue({ scope: { ...SCOPE, runId: '4' } });
  for (const sourceDatasets of [[], [other.id], [handle.id, handle.id], ['ds_00000000000000000000000000000000']]) {
    const output = outputFor(handle.id);
    output.evidence[0].sourceDatasets = sourceDatasets;
    await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output }), denies('invalid_output_lineage'));
  }
});

test('all contributing datasets intersect disclosure constraints', async () => {
  const policies = {
    'finance-aggregate-v1': { evidenceKinds: ['aggregate', 'summary', 'table'], labels: ['total'], minGroupSize: 3, artifactMimeTypes: ['application/json'] },
    'restricted-v1': { evidenceKinds: ['aggregate'], labels: ['count'], minGroupSize: 3, artifactMimeTypes: [] },
  };
  const f = fixture({ policies });
  const first = await f.issue();
  const second = await f.issue({ disclosurePolicy: 'restricted-v1' });
  const output = outputFor(first.id);
  // Guest-reported lineage cannot omit a restrictive input it could read.
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [first.id, second.id], output }), denies('invalid_output_lineage'));
  output.evidence[0].sourceDatasets.push(second.id);
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [first.id, second.id], output }), denies('disclosure_label_denied'));
});

test('emitted evidence and artifacts share cumulative row/cell/byte ceilings', async () => {
  const f = fixture({ limits: { maxOutputRows: 1 } });
  const handle = await f.issue();
  const output = outputFor(handle.id);
  output.evidence.push(structuredClone(output.evidence[0]));
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output }), denies('output_limit'));
  const g = fixture({ limits: { maxOutputBytes: 10 } });
  const other = await g.issue();
  await assert.rejects(g.broker.validateOutput({ scope: SCOPE, handleIds: [other.id], output: outputFor(other.id) }), denies('byte_limit'));
});

test('artifacts are canonical, hashed JSON with the same disclosure boundary', async () => {
  const f = fixture();
  const handle = await f.issue();
  const content = { kind: 'table', value: { columns: ['total'], rows: [{ values: [60], count: 3 }] } };
  const output = { evidence: [], artifacts: [{ name: 'report.json', mimeType: 'application/json', content: JSON.stringify(content, null, 2), sourceDatasets: [handle.id] }] };
  const admitted = await f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output });
  assert.match(admitted.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(admitted.artifacts[0].content, JSON.stringify(content));
  assert.equal(admitted.artifacts[0].bytes, Buffer.byteLength(JSON.stringify(content)));
  for (const name of ['../report.json', '/report.json', 'report.html', 'a\\report.json']) {
    const bad = structuredClone(output);
    bad.artifacts[0].name = name;
    await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: bad }), denies('invalid_artifact_name'));
  }
  const badMime = structuredClone(output);
  badMime.artifacts[0].mimeType = 'text/html';
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: badMime }), denies('artifact_mime_denied'));
  const raw = structuredClone(output);
  raw.artifacts[0].content = JSON.stringify({ kind: 'aggregate', value: { label: 'total', value: 'private A', count: 3 } });
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: raw }), denies('invalid_metric'));
});

test('unknown metadata, unsafe keys, cycles and excess nesting never become outputs', async () => {
  const f = fixture();
  const handle = await f.issue();
  await assert.rejects(f.issue({ storageUrl: 'postgres://secret' }), denies('invalid_fields'));
  const poisoned = JSON.parse('{"evidence":[],"artifacts":[],"__proto__":{"polluted":true}}');
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: poisoned }), denies('unsafe_key'));
  const cycle = outputFor(handle.id);
  cycle.evidence[0].value.self = cycle;
  await assert.rejects(f.broker.validateOutput({ scope: SCOPE, handleIds: [handle.id], output: cycle }), denies('non_json_value'));
  assert.equal({}.polluted, undefined);
});
