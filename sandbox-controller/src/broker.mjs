import { createHash, randomBytes } from 'node:crypto';

/** A broker refusal never includes source rows or program output. */
export class BrokerError extends Error {
  constructor(code) {
    super(`sandbox broker refused: ${code}`);
    this.name = 'BrokerError';
    this.code = code;
  }
}

const DEFAULT_LIMITS = Object.freeze({
  maxRows: 1_000,
  maxBytes: 1_048_576,
  maxOutputRows: 20,
  maxOutputBytes: 65_536,
  maxEvidence: 16,
  maxArtifactBytes: 65_536,
  maxArtifacts: 4,
  maxDepth: 12,
  maxCells: 200,
  ttlMs: 900_000,
});

/** These shapes intentionally provide no unrestricted text/row export channel. */
export const DEFAULT_DISCLOSURE_POLICIES = Object.freeze({
  'finance-aggregate-v1': Object.freeze({
    evidenceKinds: ['aggregate', 'summary', 'table'],
    labels: ['total', 'count', 'average', 'minimum', 'maximum', 'balance', 'variance'],
    minGroupSize: 3,
    artifactMimeTypes: ['application/json'],
  }),
});

const SCOPE_KEYS = ['actorIdentity', 'organizationId', 'companyId', 'runId', 'policyGeneration'];
const ISSUE_KEYS = ['scope', 'schema', 'rows', 'expiresAt', 'limits', 'disclosurePolicy',
  'sourceCapabilities', 'watermark', 'provenanceRef'];
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HANDLE = /^ds_[a-f0-9]{32}$/;

function refuse(code) { throw new BrokerError(code); }

function exactKeys(value, allowed, required = allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('invalid_shape');
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    refuse('invalid_fields');
  }
}

function positive(value, code = 'invalid_limit') {
  if (!Number.isSafeInteger(value) || value <= 0) refuse(code);
  return value;
}

function reference(value) {
  if (typeof value !== 'string' || !REF.test(value)) refuse('invalid_reference');
  return value;
}

function scopeValue(scope) {
  exactKeys(scope, SCOPE_KEYS);
  // Native identities can be hexadecimal; only canonical numeric IDs are decimal.
  if (typeof scope.actorIdentity !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(scope.actorIdentity)) {
    refuse('invalid_actor');
  }
  for (const key of ['organizationId', 'companyId', 'runId']) {
    if (typeof scope[key] !== 'string' || !/^[1-9][0-9]{0,19}$/.test(scope[key])
      || BigInt(scope[key]) > 18_446_744_073_709_551_615n) refuse('invalid_scope');
  }
  reference(scope.policyGeneration);
  return { ...scope };
}

function limitsValue(overrides, ceiling) {
  if (overrides === undefined) return { ...ceiling };
  exactKeys(overrides, Object.keys(DEFAULT_LIMITS), []);
  const limits = { ...ceiling };
  for (const [key, value] of Object.entries(overrides)) limits[key] = Math.min(positive(value), ceiling[key]);
  return limits;
}

/** Reject non-JSON, excess depth and dangerous record keys before serialization. */
function boundedJson(value, maxBytes, maxDepth) {
  const seen = new Set();
  function visit(item, depth) {
    if (depth > maxDepth) refuse('depth_limit');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) refuse('non_json_value');
      return;
    }
    if (typeof item !== 'object' || seen.has(item)) refuse('non_json_value');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) refuse('non_json_value');
    seen.add(item);
    for (const key of Object.keys(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) refuse('unsafe_key');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) refuse('non_json_value');
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || Buffer.byteLength(json) > maxBytes) refuse('byte_limit');
  return { json, value: JSON.parse(json) };
}

function schemaValue(schema) {
  exactKeys(schema, ['ref', 'fields']);
  reference(schema.ref);
  if (!Array.isArray(schema.fields) || !schema.fields.length || schema.fields.length > 64) refuse('invalid_schema');
  const names = new Set();
  for (const field of schema.fields) {
    exactKeys(field, ['name', 'type', 'nullable'], ['name', 'type']);
    if (typeof field.name !== 'string' || !FIELD.test(field.name) || names.has(field.name)
      || ['constructor', 'prototype', '__proto__'].includes(field.name)) refuse('invalid_schema');
    names.add(field.name);
    if (!['string', 'number', 'boolean'].includes(field.type)
      || (field.nullable !== undefined && typeof field.nullable !== 'boolean')) refuse('invalid_schema');
  }
  return structuredClone(schema);
}

function validateRows(rows, schema, limits) {
  if (!Array.isArray(rows) || rows.length > limits.maxRows) refuse('row_limit');
  const bounded = boundedJson(rows, limits.maxBytes, limits.maxDepth);
  const names = schema.fields.map((field) => field.name);
  for (const row of bounded.value) {
    exactKeys(row, names);
    for (const field of schema.fields) {
      if (row[field.name] === null && field.nullable === true) continue;
      if (typeof row[field.name] !== field.type) refuse('row_schema_mismatch');
    }
  }
  return bounded;
}

function normalizePolicies(policies) {
  const normalized = new Map();
  for (const [id, policy] of Object.entries(policies)) {
    reference(id);
    exactKeys(policy, ['evidenceKinds', 'labels', 'minGroupSize', 'artifactMimeTypes']);
    if (!Array.isArray(policy.evidenceKinds) || !policy.evidenceKinds.length
      || policy.evidenceKinds.some((kind) => !['aggregate', 'summary', 'table'].includes(kind))
      || !Array.isArray(policy.labels) || !policy.labels.length
      || policy.labels.some((label) => typeof label !== 'string' || !FIELD.test(label))
      || new Set(policy.labels).size !== policy.labels.length
      || !Array.isArray(policy.artifactMimeTypes)
      || policy.artifactMimeTypes.some((mime) => mime !== 'application/json')) refuse('invalid_disclosure_policy');
    positive(policy.minGroupSize, 'invalid_disclosure_policy');
    normalized.set(id, structuredClone(policy));
  }
  return normalized;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

/**
 * Trusted controller broker. `authorize` must consult current gateway policy.
 * The store is private operational persistence, never a model-facing API:
 * putDataset(record), getDataset(id), revokeDataset(id).
 */
export class DatasetBroker {
  #store;
  #authorize;
  #clock;
  #limits;
  #policies;

  constructor({ store, authorize, clock = Date.now, limits, policies = DEFAULT_DISCLOSURE_POLICIES }) {
    if (!store || !['putDataset', 'getDataset', 'revokeDataset'].every((key) => typeof store[key] === 'function')
      || typeof authorize !== 'function' || typeof clock !== 'function') refuse('missing_trusted_dependency');
    this.#store = store;
    this.#authorize = authorize;
    this.#clock = clock;
    this.#limits = limitsValue(limits, DEFAULT_LIMITS);
    this.#policies = normalizePolicies(policies);
  }

  async #admit(scope, operation, handleIds) {
    if (await this.#authorize({ scope: { ...scope }, operation, handleIds: [...handleIds] }) !== true) {
      refuse('authorization_denied');
    }
  }

  async issue(request) {
    exactKeys(request, ISSUE_KEYS, ['scope', 'schema', 'rows', 'expiresAt']);
    const scope = scopeValue(request.scope);
    const schema = schemaValue(request.schema);
    const limits = limitsValue(request.limits, this.#limits);
    const disclosurePolicy = request.disclosurePolicy ?? 'finance-aggregate-v1';
    const policy = this.#policies.get(disclosurePolicy);
    if (!policy) refuse('unknown_disclosure_policy');
    const expiresAtMs = Date.parse(request.expiresAt);
    if (typeof request.expiresAt !== 'string' || !Number.isFinite(expiresAtMs)
      || new Date(expiresAtMs).toISOString() !== request.expiresAt
      || expiresAtMs <= this.#clock() || expiresAtMs - this.#clock() > limits.ttlMs) refuse('invalid_expiry');
    const sourceCapabilities = request.sourceCapabilities ?? [];
    if (!Array.isArray(sourceCapabilities) || sourceCapabilities.length > 32
      || new Set(sourceCapabilities).size !== sourceCapabilities.length) refuse('invalid_reference');
    sourceCapabilities.forEach(reference);
    if (request.watermark !== undefined) reference(request.watermark);
    if (request.provenanceRef !== undefined) reference(request.provenanceRef);
    const rows = validateRows(request.rows, schema, limits);
    await this.#admit(scope, 'issue', []);
    if (expiresAtMs <= this.#clock()) refuse('expired_handle');
    const id = `ds_${randomBytes(16).toString('hex')}`;
    const record = {
      id, scope, schema, rows: rows.value, limits, disclosurePolicy,
      // Capture the policy admitted for this handle; current configuration may narrow it later.
      policyHash: sha256(JSON.stringify(policy)),
      expiresAt: request.expiresAt, revoked: false,
      contentHash: sha256(rows.json), sourceCapabilities: [...sourceCapabilities],
      ...(request.watermark === undefined ? {} : { watermark: request.watermark }),
      ...(request.provenanceRef === undefined ? {} : { provenanceRef: request.provenanceRef }),
    };
    await this.#store.putDataset(record);
    return {
      id, schemaRef: schema.ref, rowCount: record.rows.length, expiresAt: record.expiresAt,
      sourceCapabilities: [...sourceCapabilities],
      ...(record.watermark === undefined ? {} : { watermark: record.watermark }),
      ...(record.provenanceRef === undefined ? {} : { provenanceRef: record.provenanceRef }),
    };
  }

  async #record(scope, id, allowExpired = false) {
    if (typeof id !== 'string' || !HANDLE.test(id)) refuse('invalid_handle');
    const record = await this.#store.getDataset(id);
    if (!record || record.id !== id || SCOPE_KEYS.some((key) => record.scope?.[key] !== scope[key])) refuse('handle_scope_mismatch');
    if (typeof record.revoked !== 'boolean') refuse('dataset_integrity');
    if (record.revoked === true) refuse('revoked_handle');
    const expiresAtMs = Date.parse(record.expiresAt);
    if (typeof record.expiresAt !== 'string' || !Number.isFinite(expiresAtMs)
      || new Date(expiresAtMs).toISOString() !== record.expiresAt) refuse('dataset_integrity');
    if (!allowExpired && expiresAtMs <= this.#clock()) refuse('expired_handle');
    const policy = this.#policies.get(record.disclosurePolicy);
    if (!policy || sha256(JSON.stringify(policy)) !== record.policyHash) refuse('disclosure_policy_changed');
    const schema = schemaValue(record.schema);
    exactKeys(record.limits, Object.keys(DEFAULT_LIMITS));
    const limits = limitsValue(record.limits, this.#limits);
    const bounded = validateRows(record.rows, schema, limits);
    if (sha256(bounded.json) !== record.contentHash) refuse('dataset_integrity');
    return { ...record, rows: bounded.value, limits, policy };
  }

  #handles(ids) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 16 || new Set(ids).size !== ids.length) refuse('invalid_handles');
    return [...ids];
  }

  async #records(scope, ids, operation) {
    for (const id of ids) await this.#record(scope, id);
    await this.#admit(scope, operation, ids);
    // Read again after the authority check: revocation/expiry during it must take effect.
    return Promise.all(ids.map((id) => this.#record(scope, id)));
  }

  async materialize({ scope: rawScope, handleIds }) {
    const scope = scopeValue(rawScope);
    const ids = this.#handles(handleIds);
    const records = await this.#records(scope, ids, 'materialize');
    return records.map((record) => ({ id: record.id, rows: record.rows }));
  }

  async revoke({ scope: rawScope, handleId }) {
    const scope = scopeValue(rawScope);
    await this.#record(scope, handleId, true);
    await this.#admit(scope, 'revoke', [handleId]);
    await this.#store.revokeDataset(handleId);
  }

  async validateOutput({ scope: rawScope, handleIds, output }) {
    const scope = scopeValue(rawScope);
    const ids = this.#handles(handleIds);
    const records = await this.#records(scope, ids, 'export');
    const limits = Object.fromEntries(Object.keys(this.#limits).map((key) => [key,
      Math.min(this.#limits[key], ...records.map((record) => record.limits[key])),
    ]));
    const bounded = boundedJson(output, limits.maxOutputBytes, limits.maxDepth).value;
    exactKeys(bounded, ['evidence', 'artifacts']);
    if (!Array.isArray(bounded.evidence) || bounded.evidence.length > limits.maxEvidence
      || !Array.isArray(bounded.artifacts) || bounded.artifacts.length > limits.maxArtifacts) refuse('output_limit');
    const byId = new Map(records.map((record) => [record.id, record]));
    let emittedRows = 0;
    let emittedCells = 0;
    const sourcesFor = (item) => {
      if (!Array.isArray(item.sourceDatasets) || !item.sourceDatasets.length
        || new Set(item.sourceDatasets).size !== item.sourceDatasets.length
        || item.sourceDatasets.length !== ids.length
        || item.sourceDatasets.some((id) => !byId.has(id))) refuse('invalid_output_lineage');
      // The guest can read every input. Its own lineage claims cannot prove
      // that it ignored a restrictive input, so every output carries all input policies.
      return item.sourceDatasets.map((id) => byId.get(id));
    };
    const valueFor = (kind, value, sources) => {
      if (sources.some((source) => !source.policy.evidenceKinds.includes(kind))) refuse('disclosure_kind_denied');
      const label = (name) => {
        if (sources.some((source) => !source.policy.labels.includes(name))) refuse('disclosure_label_denied');
      };
      const group = (count) => {
        if (!Number.isSafeInteger(count)
          || sources.some((source) => count < source.policy.minGroupSize || count > source.rows.length)) refuse('disclosure_group_denied');
      };
      const metric = (entry) => {
        exactKeys(entry, ['label', 'value', 'count']);
        label(entry.label);
        if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) refuse('invalid_metric');
        group(entry.count);
        emittedRows += 1;
        emittedCells += 1;
      };
      if (kind === 'aggregate') metric(value);
      else if (kind === 'summary') {
        exactKeys(value, ['metrics']);
        if (!Array.isArray(value.metrics) || !value.metrics.length) refuse('invalid_metric');
        value.metrics.forEach(metric);
      } else if (kind === 'table') {
        exactKeys(value, ['columns', 'rows']);
        if (!Array.isArray(value.columns) || !value.columns.length || new Set(value.columns).size !== value.columns.length
          || !Array.isArray(value.rows)) refuse('invalid_table');
        value.columns.forEach(label);
        for (const row of value.rows) {
          exactKeys(row, ['values', 'count']);
          if (!Array.isArray(row.values) || row.values.length !== value.columns.length
            || row.values.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell))) refuse('invalid_table');
          group(row.count);
          emittedRows += 1;
          emittedCells += row.values.length;
        }
      } else refuse('disclosure_kind_denied');
      if (emittedRows > limits.maxOutputRows || emittedCells > limits.maxCells) refuse('output_limit');
    };
    for (const item of bounded.evidence) {
      exactKeys(item, ['kind', 'value', 'sourceDatasets']);
      valueFor(item.kind, item.value, sourcesFor(item));
    }
    let artifactBytes = 0;
    const names = new Set();
    const artifacts = bounded.artifacts.map((artifact) => {
      exactKeys(artifact, ['name', 'mimeType', 'content', 'sourceDatasets']);
      if (typeof artifact.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(artifact.name)
        || names.has(artifact.name)) refuse('invalid_artifact_name');
      names.add(artifact.name);
      const sources = sourcesFor(artifact);
      if (sources.some((source) => !source.policy.artifactMimeTypes.includes(artifact.mimeType))) refuse('artifact_mime_denied');
      if (typeof artifact.content !== 'string') refuse('invalid_artifact_content');
      artifactBytes += Buffer.byteLength(artifact.content);
      if (artifactBytes > limits.maxArtifactBytes) refuse('artifact_byte_limit');
      let content;
      try { content = JSON.parse(artifact.content); } catch { refuse('invalid_artifact_content'); }
      exactKeys(content, ['kind', 'value']);
      valueFor(content.kind, content.value, sources);
      // Hash canonical JSON, not arbitrary serialization or a guest-chosen object path.
      const canonical = JSON.stringify(content);
      return { ...artifact, content: canonical, sha256: sha256(canonical), bytes: Buffer.byteLength(canonical) };
    });
    return { evidence: bounded.evidence, artifacts };
  }
}
