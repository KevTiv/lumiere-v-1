import { createHash } from 'node:crypto';
import { requireProductionAdmission } from './admission.mjs';
import { scopeKey } from './journal.mjs';

export class ControllerError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new ControllerError(code); };
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Raw programs, dataset rows, provider identities and logs never enter readback. */
export function executionSnapshot(record) {
  const keys = ['requestKey', 'status', 'scope', 'profileRef', 'programHash', 'datasetIds',
    'createdAt', 'updatedAt', 'evidence', 'artifacts', 'failureCode'];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined
      && (!['evidence', 'artifacts'].includes(key) || record.status === 'completed'))
    .map((key) => [key, structuredClone(record[key])]));
}

/**
 * Shared governed execution coordinator. Production admission is deliberately
 * closed in this release; synthetic mode is an in-process developer harness,
 * never an HTTP request option or environment switch.
 */
export class SandboxController {
  #journal; #broker; #provider; #authorize; #clock; #mode; #limits;
  #abort = new Map();
  #reconciling = new Map();
  constructor({ journal, broker, provider, authorize, clock = Date.now, mode = 'production', limits = {} }) {
    if (!journal || !broker || !provider || !/^[a-f0-9]{64}$/.test(provider.profileHash)
      || typeof authorize !== 'function'
      || !['production', 'synthetic'].includes(mode)) fail('controller_configuration_invalid');
    this.#journal = journal; this.#broker = broker; this.#provider = provider;
    this.#authorize = authorize; this.#clock = clock; this.#mode = mode;
    this.#limits = { maxConcurrent: 2, maxCpuMsPerDay: 3_600_000, reservedCpuMs: 60_000, ...limits };
  }
  #now() { return new Date(this.#clock()).toISOString(); }
  async #admit(scope, operation, handleIds) {
    const fields = ['actorIdentity', 'organizationId', 'companyId', 'runId', 'policyGeneration'];
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)
      || Object.keys(scope).length !== fields.length
      || fields.some((field) => typeof scope[field] !== 'string')
      || !/^[A-Za-z0-9_.:-]{1,160}$/.test(scope.actorIdentity)
      || !/^[A-Za-z0-9_.:-]{1,160}$/.test(scope.policyGeneration)
      || ['organizationId','companyId','runId'].some((field) =>
        !/^[1-9][0-9]{0,19}$/.test(scope[field]) || BigInt(scope[field]) > 18_446_744_073_709_551_615n)) {
      fail('invalid_execution_scope');
    }
    if (await this.#authorize({ scope, operation, handleIds }) !== true) fail('authorization_denied');
  }
  #scoped(scope, key) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) fail('invalid_execution_key');
    const record = this.#journal.getExecution(key);
    if (!record || scopeKey(record.scope) !== scopeKey(scope)) fail('execution_not_found');
    return record;
  }
  async inspect({ scope, requestKey }) {
    await this.#admit(scope, 'inspect', []);
    return executionSnapshot(this.#scoped(scope, requestKey));
  }
  async execute({ scope, requestKey, program, datasetIds, profileRef }) {
    if (this.#mode === 'production') requireProductionAdmission();
    if (typeof requestKey !== 'string' || !/^[a-f0-9]{64}$/.test(requestKey)
      || typeof program !== 'string' || !program.trim() || Buffer.byteLength(program) > 131_072
      || typeof profileRef !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(profileRef)
      || !Array.isArray(datasetIds) || !datasetIds.length || datasetIds.length > 16
      || datasetIds.some((id) => typeof id !== 'string' || !/^ds_[a-f0-9]{32}$/.test(id))
      || new Set(datasetIds).size !== datasetIds.length) fail('invalid_execution_request');
    if (profileRef !== `sha256:${this.#provider.profileHash}`) fail('runtime_profile_mismatch');
    await this.#admit(scope, 'execute', datasetIds);
    const programHash = createHash('sha256').update(program).digest('hex');
    const requestHash = hash({ scope: scopeKey(scope), programHash, datasetIds: [...datasetIds].sort(), profileRef });
    const now = this.#now();
    const claim = this.#journal.claimExecution({
      requestKey, scope: structuredClone(scope), requestHash, programHash,
      profileRef, datasetIds: [...datasetIds], status: 'accepted', createdAt: now, updatedAt: now,
    }, this.#limits);
    if (!claim.created) return executionSnapshot(claim.record);
    const abort = new AbortController();
    this.#abort.set(requestKey, abort);
    try {
      this.#journal.updateExecution(requestKey, { status: 'creating', updatedAt: this.#now() });
      const handle = await this.#provider.create({
        runId: scope.runId, mode: this.#mode,
        onCreated: async (sandboxHandle) => {
          this.#journal.updateExecution(requestKey, { sandboxHandle, updatedAt: this.#now() });
        },
      });
      // A persisted cancellation can race VM setup; no program starts afterward.
      if (abort.signal.aborted || this.#journal.getExecution(requestKey).cancelRequested) {
        await this.#cleanup(requestKey, 'cancelled');
        return executionSnapshot(this.#journal.getExecution(requestKey));
      }
      await this.#admit(scope, 'execute', datasetIds);
      // VM/template setup may take minutes. Recheck handle expiry, revocation,
      // policy and contents now, without retaining an earlier row copy.
      const datasets = await this.#broker.materialize({ scope, handleIds: datasetIds });
      if (abort.signal.aborted || this.#journal.getExecution(requestKey).cancelRequested) {
        await this.#cleanup(requestKey, 'cancelled');
        return executionSnapshot(this.#journal.getExecution(requestKey));
      }
      const output = await this.#provider.execute(handle, {
        input: { program, datasets, limits: { timeoutMs: 2_000, memoryBytes: 33_554_432,
          maxOutputBytes: 65_536, maxEvidence: 16, maxArtifactBytes: 32_768 } },
        signal: abort.signal,
        onSession: async (sessionName) => {
          this.#journal.updateExecution(requestKey, { sessionName, status: 'running', updatedAt: this.#now() });
        },
      });
      await this.#complete(requestKey, output);
    } catch (error) {
      const record = this.#journal.getExecution(requestKey);
      if (error.outcomeUnknown || (record.status === 'creating' && !record.sandboxHandle)) {
        this.#journal.updateExecution(requestKey, {
          status: 'outcome_unknown', failureCode: 'sandbox_outcome_unknown', updatedAt: this.#now(),
        });
      } else {
        // Failure text can contain tenant data or provider configuration; persist only static codes.
        await this.#cleanup(requestKey, abort.signal.aborted ? 'cancelled' : 'failed', 'sandbox_execution_failed');
      }
    } finally {
      this.#abort.delete(requestKey);
    }
    return executionSnapshot(this.#journal.getExecution(requestKey));
  }

  async #complete(key, output) {
    const record = this.#journal.getExecution(key);
    if (TERMINAL.has(record.status)) return;
    if (record.cancelRequested) return this.#cleanup(key, 'cancelled');
    const validated = await this.#broker.validateOutput({ scope: record.scope, handleIds: record.datasetIds, output });
    const current = this.#journal.getExecution(key);
    if (TERMINAL.has(current.status)) return;
    if (current.cancelRequested) return this.#cleanup(key, 'cancelled');
    for (const artifact of validated.artifacts) this.#journal.putArtifact(record.scope, artifact);
    this.#journal.updateExecution(key, { evidence: validated.evidence, artifacts: validated.artifacts, updatedAt: this.#now() });
    await this.#cleanup(key, 'completed');
  }
  async #cleanup(key, terminalStatus, failureCode) {
    const record = this.#journal.getExecution(key);
    if (TERMINAL.has(record.status)) return;
    this.#journal.updateExecution(key, { status: 'cleanup_pending', terminalStatus,
      cleanupPending: true, updatedAt: this.#now(), ...(failureCode ? { failureCode } : {}) });
    try {
      if (record.sandboxHandle) {
        const result = await this.#provider.destroy(record.sandboxHandle);
        if (result.status !== 'destroyed') throw new Error();
      }
    } catch {
      this.#journal.updateExecution(key, { status: 'cleanup_pending', terminalStatus,
        cleanupPending: true, updatedAt: this.#now() });
      return;
    }
    for (const id of record.datasetIds) this.#journal.revokeDataset(id);
    this.#journal.finalizeExecution(key, { status: terminalStatus, terminalStatus,
      cleanupPending: false, finishedAt: this.#now(), updatedAt: this.#now(),
      ...(failureCode ? { failureCode } : {}) });
  }

  async cancel({ scope, requestKey }) {
    await this.#admit(scope, 'cancel', []);
    const record = this.#scoped(scope, requestKey);
    if (TERMINAL.has(record.status)) return executionSnapshot(record);
    this.#journal.updateExecution(requestKey, { cancelRequested: true, updatedAt: this.#now() });
    this.#abort.get(requestKey)?.abort();
    if (!this.#abort.has(requestKey) && record.sandboxHandle) await this.#cleanup(requestKey, 'cancelled');
    return executionSnapshot(this.#journal.getExecution(requestKey));
  }

  /** Never redispatch on restart. Release requires fresh broker authorization. */
  async reconcile(request) {
    const identity = `${scopeKey(request.scope)}:${request.requestKey}`;
    if (this.#reconciling.has(identity)) return this.#reconciling.get(identity);
    const pending = this.#reconcile(request);
    this.#reconciling.set(identity, pending);
    try { return await pending; }
    finally { this.#reconciling.delete(identity); }
  }
  async #reconcile({ scope, requestKey }) {
    await this.#admit(scope, 'inspect', []);
    const record = this.#scoped(scope, requestKey);
    if (TERMINAL.has(record.status)) return executionSnapshot(record);
    if (this.#abort.has(requestKey)) return executionSnapshot(record);
    if (record.status === 'accepted') {
      await this.#cleanup(requestKey, 'failed', 'sandbox_setup_interrupted');
    } else if (!record.sandboxHandle) {
      this.#journal.updateExecution(requestKey, { status: 'outcome_unknown', updatedAt: this.#now() });
    } else if (record.status === 'cleanup_pending' || record.cancelRequested) {
      await this.#cleanup(requestKey, record.cancelRequested ? 'cancelled' : record.terminalStatus ?? 'failed');
    } else {
      const observed = await this.#provider.reconcile(record.sandboxHandle, record.sessionName);
      if (observed.status === 'completed') {
        try { await this.#complete(requestKey, observed.output); }
        catch { await this.#cleanup(requestKey, 'failed', 'sandbox_output_rejected'); }
      } else if (['failed', 'destroyed'].includes(observed.status) || observed.expired) {
        await this.#cleanup(requestKey, 'failed', 'sandbox_execution_failed');
      }
    }
    return executionSnapshot(this.#journal.getExecution(requestKey));
  }

  /** Cleanup is allowed to narrow authority even when the original user is gone. */
  async reapExpired() {
    this.#journal.purgeExpiredDatasets(this.#clock());
    for (const record of this.#journal.listUnsettled()) {
      if (this.#abort.has(record.requestKey)) continue;
      if (record.sandboxHandle && record.sandboxHandle.expiresAt <= this.#clock()) {
        await this.#cleanup(record.requestKey, 'failed', 'sandbox_deadline_expired');
      }
    }
  }
}
