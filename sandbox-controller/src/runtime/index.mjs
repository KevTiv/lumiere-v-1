import { Worker } from 'node:worker_threads';

/** These are controller-enforced ceilings, not values authored by the guest. */
export const RUNTIME_CEILINGS = Object.freeze({
  timeoutMs: 30_000,
  memoryBytes: 128 * 1024 * 1024,
  maxOutputBytes: 256 * 1024,
  maxEvidence: 64,
  maxArtifactBytes: 128 * 1024,
  maxInputBytes: 8 * 1024 * 1024,
  maxProgramBytes: 128 * 1024,
  maxDatasets: 16,
  maxRows: 10_000,
});

const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 2_000,
  memoryBytes: 32 * 1024 * 1024,
  maxOutputBytes: 64 * 1024,
  maxEvidence: 16,
  maxArtifactBytes: 32 * 1024,
});

const MESSAGES = Object.freeze({
  invalid_input: 'JavaScript execution input is invalid',
  time_limit: 'JavaScript execution exceeded its deadline',
  cancelled: 'JavaScript execution was cancelled',
  execution_failed: 'JavaScript program failed',
  output_rejected: 'JavaScript output was rejected',
  memory_limit: 'JavaScript execution exceeded its memory limit',
  async_denied: 'Asynchronous JavaScript programs are not supported',
  worker_failed: 'JavaScript execution worker failed',
});

/** Guest exception messages never cross this boundary: they may contain data. */
export class JavaScriptRuntimeError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.worker_failed);
    this.name = 'JavaScriptRuntimeError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'worker_failed';
  }
}

function invalid() {
  throw new JavaScriptRuntimeError('invalid_input');
}

function plainObject(value) {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateJson(value, ancestors = new Set(), depth = 0) {
  if (depth > 64) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !plainObject(value)) invalid();
  if (ancestors.has(value)) invalid();
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') invalid();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) invalid();
    validateJson(property.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function normalizeInput(input) {
  if (!plainObject(input) || typeof input.program !== 'string' || !input.program.trim()) invalid();
  if (Buffer.byteLength(input.program) > RUNTIME_CEILINGS.maxProgramBytes) invalid();
  if (!Array.isArray(input.datasets) || input.datasets.length > RUNTIME_CEILINGS.maxDatasets) invalid();
  const ids = new Set();
  let rowCount = 0;
  for (const dataset of input.datasets) {
    if (!plainObject(dataset) || typeof dataset.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(dataset.id)
      || ids.has(dataset.id) || !Array.isArray(dataset.rows)) invalid();
    ids.add(dataset.id);
    rowCount += dataset.rows.length;
    if (rowCount > RUNTIME_CEILINGS.maxRows) invalid();
    validateJson(dataset.rows);
  }
  const limits = { ...DEFAULT_LIMITS };
  if (input.limits !== undefined) {
    if (!plainObject(input.limits)) invalid();
    for (const [key, value] of Object.entries(input.limits)) {
      if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value)
        || value <= 0 || value > RUNTIME_CEILINGS[key]) invalid();
      limits[key] = value;
    }
  }
  if (limits.memoryBytes < 1024 * 1024 || limits.maxArtifactBytes > limits.maxOutputBytes) invalid();
  const normalized = {
    program: input.program,
    datasets: input.datasets.map(({ id, rows }) => ({ id, rows })),
    limits,
  };
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized) > RUNTIME_CEILINGS.maxInputBytes) invalid();
  return JSON.parse(serialized);
}

/**
 * Run guest JavaScript in QuickJS WASM in a disposable worker.
 *
 * This function never exposes a Node object or host callback to guest code.
 * The enclosing Railway VM remains the deployment isolation perimeter; this
 * capability-only engine is not a claim of provider/network certification.
 */
export async function runJavaScript(input, { signal } = {}) {
  const normalized = normalizeInput(input);
  if (signal?.aborted) throw new JavaScriptRuntimeError('cancelled');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: normalized,
      // V8's budget supplements QuickJS's own WASM heap budget. Nothing in
      // workerData contains controller configuration or standing credentials.
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      env: {},
      // Do not inherit loaders, eval/input-type or debugger flags from the
      // controller. This fixed worker imports only its pinned runtime bundle.
      execArgv: [],
      stdout: true,
      stderr: true,
    });
    // Never pipe guest diagnostics into controller logs or model context.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // Resolving waits for worker teardown, including on timeout/cancellation.
      worker.terminate().then(
        () => error ? reject(error) : resolve(result),
        () => reject(new JavaScriptRuntimeError('worker_failed')),
      );
    };
    const abort = () => finish(new JavaScriptRuntimeError('cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new JavaScriptRuntimeError('time_limit')), normalized.limits.timeoutMs);
    worker.once('message', message => {
      if (!message || typeof message !== 'object' || message.ok !== true) {
        finish(new JavaScriptRuntimeError(message?.code));
        return;
      }
      const result = message.result;
      try {
        validateJson(result);
        if (!plainObject(result) || !Array.isArray(result.evidence) || !Array.isArray(result.artifacts)
          || Buffer.byteLength(JSON.stringify(result)) > normalized.limits.maxOutputBytes) {
          throw new Error('invalid worker output');
        }
        finish(null, result);
      } catch {
        finish(new JavaScriptRuntimeError('output_rejected'));
      }
    });
    worker.once('error', () => finish(new JavaScriptRuntimeError('worker_failed')));
    worker.once('exit', () => {
      if (!settled) finish(new JavaScriptRuntimeError('worker_failed'));
    });
    if (signal?.aborted) abort();
  });
}
