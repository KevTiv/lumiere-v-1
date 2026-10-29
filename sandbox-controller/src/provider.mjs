import {
  createRuntimeProfile, INPUT_PATH, OUTPUT_PATH, RUNTIME_ROOT,
  NODE_ROOT, NODE_RUNTIME, RUNNER_COMMAND, requireSyntheticAdmission, SandboxProviderError,
} from './profile.mjs';

const NODE_ARCHIVE_PATH = '/tmp/lumiere-node-runtime.tar.xz';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

// Runs only in a tenant-free template. The preinstalled Node is a trusted
// bootstrap tool, never the analysis interpreter. No redirects or unverified
// extraction; a different host architecture fails before the download.
export const NODE_BOOTSTRAP_COMMAND = `env -u NODE_OPTIONS -u NODE_PATH node --input-type=module -e ${shellQuote(`
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
if (process.platform !== '${NODE_RUNTIME.platform}' || process.arch !== '${NODE_RUNTIME.arch}') {
  throw new Error('unsupported_runtime_architecture');
}
const response = await fetch('${NODE_RUNTIME.archiveUrl}', {
  redirect: 'error', signal: AbortSignal.timeout(30_000),
});
if (!response.ok || !response.body) throw new Error('node_archive_unavailable');
const limit = 67_108_864;
const chunks = [];
let size = 0;
for await (const chunk of response.body) {
  size += chunk.byteLength;
  if (size > limit) throw new Error('node_archive_too_large');
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
if (createHash('sha256').update(bytes).digest('hex') !== '${NODE_RUNTIME.archiveSha256}') {
  throw new Error('node_archive_checksum_mismatch');
}
await writeFile('${NODE_ARCHIVE_PATH}', bytes, { flag: 'wx', mode: 0o600 });
`)} && mkdir -p ${NODE_ROOT} && tar -xJf ${NODE_ARCHIVE_PATH} --strip-components=1 -C ${NODE_ROOT} && rm ${NODE_ARCHIVE_PATH} && env -i ${NODE_ROOT}/bin/node --input-type=module -e ${shellQuote(`if (process.version !== 'v${NODE_RUNTIME.version}' || process.platform !== '${NODE_RUNTIME.platform}' || process.arch !== '${NODE_RUNTIME.arch}') throw new Error('node_runtime_mismatch')`)}`;

export const PINNED_NPM_INSTALL_COMMAND = `env -i PATH=${NODE_ROOT}/bin:/usr/bin:/bin HOME=/tmp/lumiere-npm ${NODE_ROOT}/bin/node ${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts --no-audit --no-fund --cache /tmp/lumiere-npm/cache`;

function opaqueId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Actual Railway SDK driver. No caller-supplied endpoint or shell command. */
export async function createRailwayDriver(SandboxClass) {
  const Sandbox = SandboxClass ?? (await import('railway')).Sandbox;
  return {
    async create(profile, auth) {
      let template = Sandbox.template().run(NODE_BOOTSTRAP_COMMAND);
      for (const [path, content] of Object.entries(profile.runtimeFiles)) {
        const absolute = `${RUNTIME_ROOT}/${path}`;
        const directory = absolute.slice(0, absolute.lastIndexOf('/'));
        const base64 = Buffer.from(content).toString('base64');
        // Paths have a strict trusted-profile allowlist; base64 carries no
        // shell metacharacters. Tenant code/data never enters this template.
        template = template.run(`mkdir -p ${directory} && printf %s ${base64} | base64 -d > ${absolute}`);
      }
      template = template.workdir(RUNTIME_ROOT)
        .run(PINNED_NPM_INSTALL_COMMAND);
      await template.build({ ...auth, region: profile.region });
      // SDK create(template) repeats its build lookup with this region. Pin
      // both calls so no implicit US West build can precede the readback.
      return Sandbox.create(template, {
        ...auth, region: profile.region, networkIsolation: 'ISOLATED', env: {}, domains: [],
        resources: { cpu: profile.cpu, memoryGB: profile.memoryGB },
        idleTimeoutMinutes: profile.idleTimeoutMinutes,
      });
    },
    connect(id, auth) { return Sandbox.connect(id, auth); },
    list(auth) { return Sandbox.list({ ...auth, first: 100 }); },
  };
}

export class RailwaySandboxProvider {
  #auth;
  #profile;
  #driver;
  #clock;
  #executions = new Map();

  constructor({ token, environmentId, profile, driver, clock = Date.now }) {
    if (typeof token !== 'string' || !token.trim() || !opaqueId(environmentId)) {
      throw new SandboxProviderError('railway_configuration_required');
    }
    // Recompute rather than accepting a caller-provided digest.
    this.#profile = createRuntimeProfile(profile);
    this.#auth = { token, environmentId, verbose: false };
    this.#driver = Promise.resolve(driver ?? createRailwayDriver());
    this.#clock = clock;
  }

  get profileHash() { return this.#profile.digest; }

  #assertObserved(sandbox, { terminal = false } = {}) {
    if (!opaqueId(sandbox.id) || sandbox.environmentId !== this.#auth.environmentId
        || sandbox.networkIsolation !== 'ISOLATED' || sandbox.region !== this.#profile.region
        || !Array.isArray(sandbox.domains) || sandbox.domains.length !== 0
        || sandbox.idleTimeoutMinutes !== this.#profile.idleTimeoutMinutes
        || (!terminal && sandbox.status !== 'RUNNING')) {
      throw new SandboxProviderError('sandbox_observed_policy_mismatch');
    }
  }

  #assertHandle(handle, { allowExpired = false } = {}) {
    if (!handle || !opaqueId(handle.id) || !opaqueId(handle.runId)
        || handle.profileHash !== this.#profile.digest || handle.mode !== 'synthetic'
        || handle.region !== this.#profile.region
        || !Number.isSafeInteger(handle.expiresAt)
        || !Number.isSafeInteger(handle.createdAt)
        || handle.expiresAt - handle.createdAt !== this.#profile.maxDurationMs
        || (!allowExpired && this.#clock() >= handle.expiresAt)) {
      throw new SandboxProviderError('sandbox_handle_invalid_or_expired');
    }
  }

  async #connect(handle, { allowExpired = false, terminal = false } = {}) {
    this.#assertHandle(handle, { allowExpired });
    try {
      const sandbox = await (await this.#driver).connect(handle.id, this.#auth);
      this.#assertObserved(sandbox, { terminal });
      return sandbox;
    } catch (error) {
      if (error instanceof SandboxProviderError) throw error;
      if (error?.name === 'SandboxNotFoundError') throw new SandboxProviderError('sandbox_not_found');
      throw new SandboxProviderError('sandbox_connection_unavailable', { outcomeUnknown: true });
    }
  }

  async create({ runId, mode, onCreated }) {
    requireSyntheticAdmission(mode);
    if (!opaqueId(runId) || typeof onCreated !== 'function') {
      throw new SandboxProviderError('durable_create_callback_required');
    }
    let sandbox;
    let elapsed = false;
    let cleanup;
    let timer;
    const cleanupCreated = () => {
      cleanup ??= (async () => {
        await sandbox.destroy();
        await sandbox.refresh();
        if (sandbox.status !== 'DESTROYED') throw new Error();
      })();
      return cleanup;
    };
    const creation = (async () => {
      try {
        sandbox = await (await this.#driver).create(this.#profile, this.#auth);
      } catch {
        // A lost API response can leave a VM whose ID is still unavailable.
        // Retain reservation; automatic retry cannot safely identify an orphan.
        throw new SandboxProviderError('sandbox_create_outcome_unknown', { outcomeUnknown: true });
      }
      const createdAt = this.#clock();
      const handle = {
        id: sandbox.id, runId, mode, profileHash: this.#profile.digest,
        region: this.#profile.region, createdAt,
        expiresAt: createdAt + this.#profile.maxDurationMs,
      };
      try {
        // Invoke even after timeout to attach a late-discovered ID to the
        // journal. The callback must preserve any prior unknown/terminal state.
        const persisted = Promise.resolve(onCreated(handle));
        if (elapsed) cleanupCreated().catch(() => {});
        await persisted;
        if (elapsed) {
          await cleanupCreated();
          throw new SandboxProviderError('sandbox_create_outcome_unknown', { outcomeUnknown: true });
        }
        this.#assertObserved(sandbox);
        return Object.freeze(handle);
      } catch (error) {
        try { await cleanupCreated(); } catch {
          throw new SandboxProviderError('sandbox_create_cleanup_unknown', { outcomeUnknown: true });
        }
        if (error instanceof SandboxProviderError && error.outcomeUnknown) throw error;
        throw new SandboxProviderError('sandbox_create_rejected');
      }
    })();
    // Always observe the late rejection, including after the response deadline.
    creation.catch(() => {});
    try {
      return await Promise.race([creation, new Promise((_, reject) => {
        timer = setTimeout(() => {
          elapsed = true;
          if (sandbox) cleanupCreated().catch(() => {});
          reject(new SandboxProviderError('sandbox_create_outcome_unknown', { outcomeUnknown: true }));
        }, this.#profile.createTimeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  async execute(handle, { input, onSession, signal } = {}) {
    this.#assertHandle(handle);
    if (typeof onSession !== 'function') throw new SandboxProviderError('durable_session_callback_required');
    let bytes;
    try { bytes = Buffer.from(JSON.stringify(input)); } catch {
      throw new SandboxProviderError('sandbox_input_invalid');
    }
    if (bytes.length > this.#profile.maxInputBytes) throw new SandboxProviderError('sandbox_input_too_large');
    const sandbox = await this.#connect(handle);
    let sessions;
    try { sessions = await sandbox.sessions(); } catch {
      throw new SandboxProviderError('sandbox_sessions_unknown', { outcomeUnknown: true });
    }
    if (sessions === null || sessions.some(session => session.kind === 'EXEC' && session.command === RUNNER_COMMAND)
        || this.#executions.has(handle.id)) {
      throw new SandboxProviderError('sandbox_execution_requires_reconciliation', { outcomeUnknown: true });
    }
    if (signal?.aborted) throw new SandboxProviderError('sandbox_execution_cancelled');
    try { await sandbox.files.write(INPUT_PATH, bytes, { mode: 0o600 }); } catch {
      throw new SandboxProviderError('sandbox_materialization_failed');
    }
    this.#assertHandle(handle);
    this.#executions.set(handle.id, true);
    let execution;
    let resultPromise;
    try {
      const timeoutSec = Math.max(1, Math.ceil((handle.expiresAt - this.#clock()) / 1000));
      execution = sandbox.exec(RUNNER_COMMAND, {
        timeoutSec, maxOutputBytes: 4096, captureOutput: true,
        env: {}, cwd: RUNTIME_ROOT, ...(signal ? { signal } : {}),
      });
      // Attach a rejection handler immediately while session persistence runs.
      resultPromise = Promise.resolve(execution);
      resultPromise.catch(() => {});
      const sessionName = await execution.sessionName;
      if (!opaqueId(sessionName)) throw new Error();
      await onSession(sessionName);
      const result = await resultPromise;
      return await this.#completed(sandbox, result);
    } catch (error) {
      if (error instanceof SandboxProviderError) throw error;
      if (execution && !resultPromise) Promise.resolve(execution).catch(() => {});
      // A lost connection or failed journal write is not proof the command
      // stopped. Keep sandbox/session identity for reconciliation.
      throw new SandboxProviderError('sandbox_execution_outcome_unknown', { outcomeUnknown: true });
    }
  }

  async #completed(sandbox, result) {
    if (result.exitCode === null) {
      throw new SandboxProviderError('sandbox_execution_outcome_unknown', { outcomeUnknown: true });
    }
    if (result.timedOut) throw new SandboxProviderError('sandbox_execution_timed_out');
    if (result.exitCode !== 0 || result.truncated || result.stdout || result.stderr) {
      // Runtime stdout/stderr are diagnostic and never model-visible evidence.
      throw new SandboxProviderError('sandbox_execution_failed');
    }
    return this.#collect(sandbox);
  }

  async #collect(sandbox) {
    try {
      const entry = await sandbox.files.stat(OUTPUT_PATH);
      if (entry.isDir || !Number.isSafeInteger(entry.size) || entry.size < 1
          || entry.size > this.#profile.maxResultBytes) {
        throw new SandboxProviderError('sandbox_output_too_large_or_invalid');
      }
      const bytes = await sandbox.files.read(OUTPUT_PATH, {
        format: 'bytes', length: this.#profile.maxResultBytes + 1,
      });
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.size
          || bytes.byteLength > this.#profile.maxResultBytes) {
        throw new SandboxProviderError('sandbox_output_too_large_or_invalid');
      }
      const output = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!output || Array.isArray(output) || typeof output !== 'object') throw new Error();
      return output; // Broker performs schema, disclosure and source validation.
    } catch (error) {
      if (error instanceof SandboxProviderError) throw error;
      throw new SandboxProviderError('sandbox_output_invalid');
    }
  }

  async reconcile(handle, sessionName) {
    const sandbox = await this.#connect(handle, { allowExpired: true, terminal: true });
    if (sandbox.status === 'DESTROYED') return { status: 'destroyed' };
    if (sandbox.status !== 'RUNNING') return { status: 'unknown' };
    let sessions;
    try { sessions = await sandbox.sessions(); } catch { return { status: 'unknown' }; }
    if (!Array.isArray(sessions)) return { status: 'unknown' };
    const candidates = sessions.filter(session => session.kind === 'EXEC' && session.command === RUNNER_COMMAND
      && (sessionName === undefined || session.name === sessionName));
    if (candidates.length !== 1) return { status: 'unknown' };
    const session = candidates[0];
    if (session.running) return { status: 'running', sessionName: session.name, expired: this.#clock() >= handle.expiresAt };
    if (session.exitCode !== 0) return { status: 'failed', sessionName: session.name };
    // Do not re-execute or reattach a fresh command. Successful completion is
    // checked against the durable session and bounded output file.
    return { status: 'completed', sessionName: session.name, output: await this.#collect(sandbox) };
  }

  async cancel(handle, sessionName) {
    if (!opaqueId(sessionName)) throw new SandboxProviderError('sandbox_session_invalid');
    const sandbox = await this.#connect(handle, { allowExpired: true });
    try {
      const sessions = await sandbox.sessions();
      const session = sessions?.find(candidate => candidate.name === sessionName && candidate.kind === 'EXEC'
        && candidate.command === RUNNER_COMMAND);
      if (!session) return { status: 'unknown' };
      if (!session.running) return { status: 'stopped' };
      const execution = sandbox.exec({ sessionName }, { maxOutputBytes: 1, captureOutput: false });
      const resultPromise = Promise.resolve(execution);
      resultPromise.catch(() => {});
      await execution.kill('TERM');
      const result = await resultPromise;
      return { status: result.exitCode === null ? 'unknown' : 'stopped' };
    } catch { return { status: 'unknown' }; }
  }

  async destroy(handle) {
    this.#assertHandle(handle, { allowExpired: true });
    try {
      const sandbox = await (await this.#driver).connect(handle.id, this.#auth);
      // Destruction is restricted to the journal's explicit ID/environment,
      // even if observed runtime policy drifted. Never destroy fleet listings.
      if (sandbox.environmentId !== this.#auth.environmentId) throw new Error();
      if (sandbox.status !== 'DESTROYED') await sandbox.destroy();
      await sandbox.refresh();
      if (sandbox.status !== 'DESTROYED') throw new Error();
      this.#executions.delete(handle.id);
      return { status: 'destroyed' };
    } catch (error) {
      if (error?.name === 'SandboxNotFoundError') return { status: 'destroyed' };
      throw new SandboxProviderError('sandbox_cleanup_outcome_unknown', { outcomeUnknown: true });
    }
  }

  async list() {
    try {
      const rows = await (await this.#driver).list(this.#auth);
      if (!Array.isArray(rows) || rows.length > 100) throw new Error();
      return {
        sandboxes: rows.filter(row => row.environmentId === this.#auth.environmentId)
          .map(row => ({ id: row.id, status: row.status, region: row.region, createdAt: row.createdAt })),
        // SDK list is one bounded page. Never claim a full orphan census from
        // a full page, or delete unknown VMs that belong to other clients.
        complete: rows.length < 100,
      };
    } catch { throw new SandboxProviderError('sandbox_list_unavailable'); }
  }
}
