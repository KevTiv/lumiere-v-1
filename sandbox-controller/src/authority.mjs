import { createHash } from 'node:crypto';

const SCOPE_KEYS = ['actorIdentity', 'organizationId', 'companyId', 'runId', 'policyGeneration'];
const OPERATIONS = new Set(['issue', 'materialize', 'export', 'revoke', 'execute', 'inspect', 'cancel']);
const MAX_RESPONSE_BYTES = 131_072;
const MAX_GRANTS = 512;

export class AuthorityError extends Error {
  constructor() {
    super('sandbox actor authority configuration is invalid');
    this.name = 'AuthorityError';
  }
}

function validRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decimalId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)
    && BigInt(value) <= 18_446_744_073_709_551_615n) return value;
  return null;
}

function validScope(scope) {
  return validRecord(scope) && Object.keys(scope).length === SCOPE_KEYS.length
    && SCOPE_KEYS.every((key) => Object.hasOwn(scope, key))
    && typeof scope.actorIdentity === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(scope.actorIdentity)
    && ['organizationId', 'companyId', 'runId'].every((key) => typeof scope[key] === 'string' && decimalId(scope[key]) === scope[key])
    && typeof scope.policyGeneration === 'string' && /^[a-f0-9]{64}$/.test(scope.policyGeneration);
}

function trustedApiUrl(value) {
  if (typeof value !== 'string') throw new AuthorityError();
  let url;
  try { url = new URL(value); } catch { throw new AuthorityError(); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]'
    || (/^127(?:\.[0-9]{1,3}){3}$/.test(url.hostname) && url.hostname.split('.').every((octet) => Number(octet) <= 255));
  const railwayPrivate = url.hostname.endsWith('.railway.internal');
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && (loopback || railwayPrivate)))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AuthorityError();
  return new URL('/v1/ai/capability-grants', url);
}

function allNumbersSafe(value, depth = 0) {
  if (depth > 12) return false;
  if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (Array.isArray(value)) return value.every((entry) => allNumbersSafe(entry, depth + 1));
  if (validRecord(value)) return Object.values(value).every((entry) => allNumbersSafe(entry, depth + 1));
  return true;
}

async function boundedJson(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error();
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new Error();
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error();
      chunks.push(Buffer.from(value));
    }
    if (signal.aborted) throw new Error();
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (!allNumbersSafe(decoded)) throw new Error();
    return decoded;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Reauthorize through the existing actor-scoped API source on every boundary.
 * This closure owns the actor token; no token is attached to scope, datasets,
 * journal records or sandbox commands. Construction is trusted configuration,
 * and neither the program nor its HTTP payload chooses the API origin/capabilities.
 */
export function createActorAuthorizer({ apiBaseUrl, actorToken, scope, requiredCapabilities,
  fetchImpl = globalThis.fetch, timeoutMs = 5_000 }) {
  const endpoint = trustedApiUrl(apiBaseUrl);
  if (!validScope(scope) || typeof actorToken !== 'string' || actorToken.length < 1
    || actorToken.length > 8_192 || /[\x00-\x20\x7f]/.test(actorToken)
    || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000
    || !Array.isArray(requiredCapabilities) || !requiredCapabilities.length || requiredCapabilities.length > 64
    || new Set(requiredCapabilities).size !== requiredCapabilities.length
    || requiredCapabilities.some((key) => typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(key))) {
    throw new AuthorityError();
  }
  const boundScope = { ...scope };
  const capabilities = [...requiredCapabilities];
  endpoint.searchParams.set('companyId', boundScope.companyId);
  return async function authorize(request) {
    // Every failure is the same non-diagnostic denial. Upstream bodies/errors
    // may contain credentials, source data, URLs or provider internals.
    try {
      if (!validRecord(request) || !validScope(request.scope)
        || SCOPE_KEYS.some((key) => request.scope[key] !== boundScope[key])
        || !OPERATIONS.has(request.operation)) return false;
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(endpoint.href, {
        method: 'GET', redirect: 'error', signal,
        headers: { authorization: `Bearer ${actorToken}`, 'x-stdb-identity': boundScope.actorIdentity, accept: 'application/json' },
      });
      if (!response.ok || response.status !== 200 || response.redirected) {
        await response.body?.cancel().catch(() => {});
        return false;
      }
      const envelope = await boundedJson(response, signal);
      const allowed = ['organizationId', 'companyId', 'actorIdentity', 'knowledgeTeamRefs',
        'placementGeneration', 'policySnapshotHash', 'capabilityGrantsHash', 'grants'];
      if (!validRecord(envelope) || Object.keys(envelope).some((key) => !allowed.includes(key))
        || decimalId(envelope.organizationId) !== boundScope.organizationId
        || decimalId(envelope.companyId) !== boundScope.companyId
        || envelope.actorIdentity !== boundScope.actorIdentity
        || !Number.isSafeInteger(envelope.placementGeneration) || envelope.placementGeneration <= 0
        || typeof envelope.policySnapshotHash !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(envelope.policySnapshotHash)
        || typeof envelope.capabilityGrantsHash !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(envelope.capabilityGrantsHash)
        || !Array.isArray(envelope.grants) || envelope.grants.length > MAX_GRANTS
        || (envelope.knowledgeTeamRefs !== undefined && (!Array.isArray(envelope.knowledgeTeamRefs)
          || envelope.knowledgeTeamRefs.length > 64 || envelope.knowledgeTeamRefs.some((ref) => typeof ref !== 'string' || ref.length > 160)))) return false;
      const generation = createHash('sha256').update(JSON.stringify({
        placementGeneration: envelope.placementGeneration,
        policySnapshotHash: envelope.policySnapshotHash,
        capabilityGrantsHash: envelope.capabilityGrantsHash,
      })).digest('hex');
      if (generation !== boundScope.policyGeneration) return false;
      const grants = new Map();
      for (const grant of envelope.grants) {
        if (!validRecord(grant) || Object.keys(grant).length !== 3
          || !['capabilityKey', 'maxRows', 'maxBytes'].every((key) => Object.hasOwn(grant, key))
          || typeof grant.capabilityKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(grant.capabilityKey)
          || !Number.isSafeInteger(grant.maxRows) || grant.maxRows <= 0
          || !Number.isSafeInteger(grant.maxBytes) || grant.maxBytes <= 0) return false;
        // Duplicate rows can only narrow an effective grant, never replace it.
        const previous = grants.get(grant.capabilityKey);
        grants.set(grant.capabilityKey, previous ? {
          maxRows: Math.min(previous.maxRows, grant.maxRows), maxBytes: Math.min(previous.maxBytes, grant.maxBytes),
        } : { maxRows: grant.maxRows, maxBytes: grant.maxBytes });
      }
      return capabilities.every((key) => grants.has(key));
    } catch {
      return false;
    }
  };
}
