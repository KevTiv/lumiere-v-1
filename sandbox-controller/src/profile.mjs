import { createHash } from 'node:crypto';

// This build can exercise the adapter only with synthetic fixtures. A release
// with independently reviewed isolation evidence must change this admission.
export const PRODUCTION_SANDBOX_ADMITTED = false;
export const RUNTIME_ROOT = '/opt/lumiere';
export const INPUT_PATH = '/workspace/lumiere/input.json';
export const OUTPUT_PATH = '/workspace/lumiere/output.json';
export const NODE_ROOT = '/opt/lumiere-node';
// Official SHA256 from https://nodejs.org/dist/v24.19.0/SHASUMS256.txt.
// The Railway base OS remains unattested; pinning Node is not an OS-image pin.
export const NODE_RUNTIME = Object.freeze({
  version: '24.19.0', platform: 'linux', arch: 'x64',
  archiveUrl: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz',
  archiveSha256: '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647',
});
export const RUNNER_COMMAND = `${NODE_ROOT}/bin/node /opt/lumiere/src/runtime/cli.mjs`;
export const RAILWAY_SDK_VERSION = '3.16.0';

export class SandboxProviderError extends Error {
  constructor(code, { outcomeUnknown = false } = {}) {
    super(code);
    this.name = 'SandboxProviderError';
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Pin trusted runtime source, lockfile and resource policy into one digest. */
export function createRuntimeProfile({
  region, runtimeFiles, cpu = 0.5, memoryGB = 0.5,
  idleTimeoutMinutes = 5, maxDurationMs = 60_000, createTimeoutMs = 120_000,
  maxInputBytes = 2_097_152, maxResultBytes = 262_144,
}) {
  if (typeof region !== 'string' || !/^[a-z0-9-]{3,64}$/.test(region)) {
    throw new SandboxProviderError('profile_region_required');
  }
  if (!Number.isFinite(cpu) || cpu < 0.25 || cpu > 2
      || !Number.isFinite(memoryGB) || memoryGB < 0.25 || memoryGB > 4
      || !integer(idleTimeoutMinutes, 1, 30)
      || !integer(maxDurationMs, 100, 300_000)
      || !integer(createTimeoutMs, 100, 300_000)
      || !integer(maxInputBytes, 1, 4_194_304)
      || !integer(maxResultBytes, 1, 1_048_576)) {
    throw new SandboxProviderError('profile_limits_invalid');
  }
  if (!runtimeFiles || Object.getPrototypeOf(runtimeFiles) !== Object.prototype) {
    throw new SandboxProviderError('profile_runtime_files_invalid');
  }
  const entries = Object.entries(runtimeFiles).sort(([a], [b]) => a.localeCompare(b));
  let size = 0;
  for (const [path, content] of entries) {
    if (!/^(package(?:-lock)?\.json|src\/runtime\/[a-zA-Z0-9_./-]+\.mjs)$/.test(path)
        || path.split('/').some(part => part === '..' || part === '.' || part === '')
        || typeof content !== 'string') {
      throw new SandboxProviderError('profile_runtime_file_invalid');
    }
    const fileBytes = Buffer.byteLength(content);
    if (fileBytes > 65_536) throw new SandboxProviderError('profile_runtime_file_too_large');
    size += fileBytes;
  }
  if (entries.length > 32 || size > 2_097_152
      || !Object.hasOwn(runtimeFiles, 'package.json')
      || !Object.hasOwn(runtimeFiles, 'package-lock.json')
      || !Object.hasOwn(runtimeFiles, 'src/runtime/cli.mjs')) {
    throw new SandboxProviderError('profile_runtime_bundle_incomplete');
  }
  let pkg;
  let lock;
  try {
    pkg = JSON.parse(runtimeFiles['package.json']);
    lock = JSON.parse(runtimeFiles['package-lock.json']);
  } catch {
    throw new SandboxProviderError('profile_runtime_lock_invalid');
  }
  if (pkg.type !== 'module' || pkg.dependencies?.['quickjs-emscripten'] !== '0.32.0'
      || Object.keys(pkg.dependencies).length !== 1 || pkg.scripts || pkg.devDependencies
      || lock.lockfileVersion !== 3
      || lock.packages?.['']?.dependencies?.['quickjs-emscripten'] !== '0.32.0') {
    throw new SandboxProviderError('profile_runtime_lock_invalid');
  }
  for (const [path, dependency] of Object.entries(lock.packages ?? {})) {
    if (path === '') continue;
    if (!path.startsWith('node_modules/') || dependency.link
        || typeof dependency.integrity !== 'string'
        || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dependency.integrity)
        || typeof dependency.resolved !== 'string'
        || !dependency.resolved.startsWith('https://registry.npmjs.org/')) {
      throw new SandboxProviderError('profile_runtime_lock_invalid');
    }
  }
  const payload = {
    version: 1, language: 'javascript', railwaySdkVersion: RAILWAY_SDK_VERSION,
    nodeRuntime: NODE_RUNTIME,
    region, cpu, memoryGB, idleTimeoutMinutes, maxDurationMs, createTimeoutMs,
    maxInputBytes, maxResultBytes, networkIsolation: 'ISOLATED',
    runnerCommand: RUNNER_COMMAND, runtimeFiles: Object.fromEntries(entries),
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return Object.freeze({ ...payload, runtimeFiles: Object.freeze(payload.runtimeFiles), digest });
}

export function requireSyntheticAdmission(mode) {
  if (mode !== 'synthetic' || PRODUCTION_SANDBOX_ADMITTED) {
    // No environment variable, request field, or caller-supplied certificate
    // can activate production execution in this build.
    throw new SandboxProviderError('sandbox_certification_required');
  }
}
