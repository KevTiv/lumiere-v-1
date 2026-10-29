import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

// Only this static bootstrap crosses into the guest alongside explicit JSON
// datasets and source. No Node objects, import loader, or host I/O callbacks
// are registered with QuickJS.
function bootstrap(datasets, limits, program) {
  'use strict';
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const keys = Reflect.ownKeys;
  const descriptor = Object.getOwnPropertyDescriptor;
  const hasOwn = Object.hasOwn;
  const isArray = Array.isArray;
  const isFinite = Number.isFinite;
  const prototype = Object.getPrototypeOf;
  const freeze = Object.freeze;
  const charCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
  const objectPrototype = Object.prototype;
  for (const value of [Object.prototype, Array.prototype, String.prototype, Number.prototype,
    Boolean.prototype, Function.prototype, RegExp.prototype, JSON]) freeze(value);

  function bytes(text) {
    let length = 0;
    for (let index = 0; index < text.length; index += 1) {
      const point = charCodeAt(text, index);
      if (point < 0x80) length += 1;
      else if (point < 0x800) length += 2;
      else if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length
        && charCodeAt(text, index + 1) >= 0xdc00 && charCodeAt(text, index + 1) <= 0xdfff) {
        length += 4;
        index += 1;
      } else length += 3;
    }
    return length;
  }

  function checkJson(value, ancestors = [], depth = 0) {
    if (depth > 64) throw Error('output_rejected');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && isFinite(value)) return;
    if (typeof value !== 'object' || (!isArray(value) && prototype(value) !== objectPrototype
      && prototype(value) !== null)) throw Error('output_rejected');
    for (let i = 0; i < ancestors.length; i += 1) {
      if (ancestors[i] === value) throw Error('output_rejected');
    }
    ancestors[ancestors.length] = value;
    const ownKeys = keys(value);
    for (let i = 0; i < ownKeys.length; i += 1) {
      const key = ownKeys[i];
      if (isArray(value) && key === 'length') continue;
      if (typeof key !== 'string') throw Error('output_rejected');
      const prop = descriptor(value, key);
      if (!prop || !hasOwn(prop, 'value') || !prop.enumerable) throw Error('output_rejected');
      checkJson(prop.value, ancestors, depth + 1);
    }
    ancestors.length -= 1;
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      const ownKeys = keys(value);
      for (let i = 0; i < ownKeys.length; i += 1) deepFreeze(value[ownKeys[i]]);
      freeze(value);
    }
    return value;
  }

  const datasetRows = Object.create(null);
  const knownIds = Object.create(null);
  for (let i = 0; i < datasets.length; i += 1) {
    const dataset = datasets[i];
    datasetRows[dataset.id] = deepFreeze(dataset.rows);
    knownIds[dataset.id] = true;
  }
  freeze(datasetRows);
  freeze(knownIds);
  const evidence = [];
  const artifacts = [];

  function validateSources(record) {
    if (!isArray(record.sourceDatasets) || record.sourceDatasets.length === 0
      || record.sourceDatasets.length > datasets.length) throw Error('output_rejected');
    const seen = Object.create(null);
    for (let i = 0; i < record.sourceDatasets.length; i += 1) {
      const id = record.sourceDatasets[i];
      if (typeof id !== 'string' || !hasOwn(knownIds, id) || hasOwn(seen, id)) throw Error('output_rejected');
      seen[id] = true;
    }
  }

  function cloneRecord(record, expectedKeys) {
    checkJson(record);
    if (!record || isArray(record) || typeof record !== 'object') throw Error('output_rejected');
    const ownKeys = keys(record);
    if (ownKeys.length !== expectedKeys.length) throw Error('output_rejected');
    for (let i = 0; i < expectedKeys.length; i += 1) {
      if (!hasOwn(record, expectedKeys[i])) throw Error('output_rejected');
    }
    const copy = parse(stringify(record));
    validateSources(copy);
    return copy;
  }

  function ensureOutputBudget() {
    if (bytes(stringify({ evidence, artifacts })) > limits.maxOutputBytes) throw Error('output_rejected');
  }

  const lumiere = deepFreeze({
    datasets: {
      open(id) {
        if (typeof id !== 'string' || !hasOwn(datasetRows, id)) throw Error('output_rejected');
        return datasetRows[id];
      },
    },
    evidence: {
      emit(record) {
        const copy = cloneRecord(record, ['kind', 'value', 'sourceDatasets']);
        if (typeof copy.kind !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(copy.kind)
          || evidence.length >= limits.maxEvidence) throw Error('output_rejected');
        evidence[evidence.length] = copy;
        ensureOutputBudget();
      },
    },
    artifacts: {
      emit(record) {
        const copy = cloneRecord(record, ['name', 'mimeType', 'content', 'sourceDatasets']);
        if (typeof copy.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(copy.name)
          || typeof copy.mimeType !== 'string' || copy.mimeType.length > 128
          || typeof copy.content !== 'string' || bytes(copy.content) > limits.maxArtifactBytes
          || artifacts.length >= limits.maxEvidence) throw Error('output_rejected');
        for (let i = 0; i < artifacts.length; i += 1) {
          if (artifacts[i].name === copy.name) throw Error('output_rejected');
        }
        artifacts[artifacts.length] = copy;
        ensureOutputBudget();
      },
    },
  });
  // Compilation and execution happen entirely in the guest engine. Function
  // constructors here never point into the Node host.
  const execute = Function('lumiere', '"use strict";\n' + program);
  const result = execute(lumiere);
  if (result !== null && (typeof result === 'object' || typeof result === 'function')
    && typeof result.then === 'function') throw Error('async_denied');
  ensureOutputBudget();
  return stringify({ evidence, artifacts });
}

let runtime;
let context;
try {
  const quickjs = await getQuickJS();
  runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(workerData.limits.memoryBytes);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + workerData.limits.timeoutMs;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  // Explicitly disable all module resolution, including dynamic imports.
  runtime.removeModuleLoader();
  context = runtime.newContext();
  // Parse JSON data rather than embedding object literals: a JSON field named
  // __proto__ must remain data and must not become an object-literal setter.
  const datasetsJson = JSON.stringify(JSON.stringify(workerData.datasets));
  const limitsJson = JSON.stringify(JSON.stringify(workerData.limits));
  const code = `(${bootstrap.toString()})(JSON.parse(${datasetsJson}),JSON.parse(${limitsJson}),${JSON.stringify(workerData.program)})`;
  const result = context.evalCode(code, 'analysis.js', { type: 'global' });
  if (result.error) {
    // Inspect only error type for classification; never return guest strings.
    const error = context.dump(result.error);
    const name = error && typeof error === 'object' ? error.name : '';
    const message = error && typeof error === 'object' ? error.message : '';
    result.error.dispose();
    const code = name === 'InternalError' && message === 'interrupted' ? 'time_limit'
      : name === 'InternalError' && message === 'out of memory' ? 'memory_limit'
        : message === 'output_rejected' ? 'output_rejected'
          : message === 'async_denied' ? 'async_denied' : 'execution_failed';
    parentPort.postMessage({ ok: false, code });
  } else {
    try {
      if (runtime.hasPendingJob()) {
        parentPort.postMessage({ ok: false, code: 'async_denied' });
      } else {
        const output = context.getString(result.value);
        if (Buffer.byteLength(output) > workerData.limits.maxOutputBytes) {
          parentPort.postMessage({ ok: false, code: 'output_rejected' });
        } else {
          parentPort.postMessage({ ok: true, result: JSON.parse(output) });
        }
      }
    } finally {
      result.value.dispose();
    }
  }
} catch {
  parentPort.postMessage({ ok: false, code: 'worker_failed' });
} finally {
  context?.dispose();
  runtime?.dispose();
}
