import assert from 'node:assert/strict';
import test from 'node:test';
import { JavaScriptRuntimeError, runJavaScript } from '../src/runtime/index.mjs';

const datasets = [{ id: 'ds_receivables', rows: [{ customer: 'A', amount: 100 }, { customer: 'B', amount: 75 }] }];
const input = (program, limits) => ({ program, datasets, ...(limits ? { limits } : {}) });
const codeIs = code => error => error instanceof JavaScriptRuntimeError && error.code === code;

test('executes real JavaScript over immutable data and emits explicit evidence and artifacts', async () => {
  const result = await runJavaScript(input(`
    const rows = lumiere.datasets.open('ds_receivables');
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    lumiere.evidence.emit({kind:'total',value:{total,count:rows.length},sourceDatasets:['ds_receivables']});
    lumiere.artifacts.emit({name:'summary.json',mimeType:'application/json',content:JSON.stringify({total}),sourceDatasets:['ds_receivables']});
  `));
  assert.deepEqual(result, {
    evidence: [{ kind: 'total', value: { total: 175, count: 2 }, sourceDatasets: ['ds_receivables'] }],
    artifacts: [{ name: 'summary.json', mimeType: 'application/json', content: '{"total":175}', sourceDatasets: ['ds_receivables'] }],
  });
});

test('guest has no Node, network, filesystem, subprocess or console globals', async () => {
  const result = await runJavaScript(input(`
    const absent = ['process','require','fetch','WebSocket','XMLHttpRequest','Deno','Bun','Buffer','console','readFile','load','std','os'];
    const exposed = absent.filter(name => typeof globalThis[name] !== 'undefined');
    const throughConstructor = lumiere.datasets.open.constructor('return typeof process')();
    lumiere.evidence.emit({kind:'probe',value:{exposed,throughConstructor},sourceDatasets:['ds_receivables']});
  `));
  assert.deepEqual(result.evidence[0].value, { exposed: [], throughConstructor: 'undefined' });
});

test('unknown and foreign dataset handles are unavailable', async () => {
  await assert.rejects(runJavaScript(input(`lumiere.datasets.open('ds_another_tenant')`)), codeIs('output_rejected'));
  await assert.rejects(runJavaScript(input(`lumiere.evidence.emit({kind:'total',value:1,sourceDatasets:['ds_foreign']})`)), codeIs('output_rejected'));
});

test('datasets cannot be changed and guest state is not reused between runs', async () => {
  await assert.rejects(runJavaScript(input(`lumiere.datasets.open('ds_receivables')[0].amount = 999`)), codeIs('execution_failed'));
  await runJavaScript(input('globalThis.tenantSecret = "A"'));
  const result = await runJavaScript(input(`lumiere.evidence.emit({kind:'probe',value:typeof globalThis.tenantSecret,sourceDatasets:['ds_receivables']})`));
  assert.equal(result.evidence[0].value, 'undefined');
  assert.equal(datasets[0].rows[0].amount, 100);
});

test('JSON __proto__ fields remain data rather than changing guest object prototypes', async () => {
  const rows = JSON.parse('[{"__proto__":{"amount":42},"amount":1}]');
  const result = await runJavaScript({
    program: `const row=lumiere.datasets.open('ds')[0]; lumiere.evidence.emit({kind:'json',value:{own:Object.hasOwn(row,'__proto__'),inherited:row.polluted===true},sourceDatasets:['ds']})`,
    datasets: [{ id: 'ds', rows }],
  });
  assert.deepEqual(result.evidence[0].value, { own: true, inherited: false });
});

test('infinite loops are terminated within the hard wall deadline', async () => {
  const start = Date.now();
  await assert.rejects(runJavaScript(input('while (true) {}', { timeoutMs: 100 })), codeIs('time_limit'));
  assert.ok(Date.now() - start < 2_000);
});

test('cancellation terminates an executing worker', async () => {
  const controller = new AbortController();
  const executing = runJavaScript(input('while (true) {}', { timeoutMs: 5_000 }), { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(executing, codeIs('cancelled'));
});

test('QuickJS allocation limits reject large allocations before the wall deadline', async () => {
  const start = Date.now();
  await assert.rejects(runJavaScript({
    program: 'const allocation = new Array(1_000_000).fill(1)',
    datasets: [],
    limits: { memoryBytes: 2 * 1024 * 1024, timeoutMs: 2_000 },
  }), codeIs('memory_limit'));
  assert.ok(Date.now() - start < 2_000);
});

test('stack recursion fails without exhausting the controller process', async () => {
  await assert.rejects(runJavaScript(input('function recurse(){ return recurse() }; recurse()')), codeIs('execution_failed'));
  const result = await runJavaScript(input(`lumiere.evidence.emit({kind:'alive',value:true,sourceDatasets:['ds_receivables']})`));
  assert.equal(result.evidence[0].value, true);
});

test('oversized output, excessive evidence, invalid JSON and forged sources are rejected', async () => {
  for (const program of [
    `lumiere.evidence.emit({kind:'dump',value:'x'.repeat(1000),sourceDatasets:['ds_receivables']})`,
    `for(let i=0;i<3;i++) lumiere.evidence.emit({kind:'count',value:i,sourceDatasets:['ds_receivables']})`,
    `lumiere.evidence.emit({kind:'dump',value:NaN,sourceDatasets:['ds_receivables']})`,
    `lumiere.evidence.emit({kind:'dump',value:1,sourceDatasets:[]})`,
    `lumiere.evidence.emit({kind:'dump',value:{get secret(){return 1}},sourceDatasets:['ds_receivables']})`,
  ]) {
    await assert.rejects(runJavaScript(input(program, { maxOutputBytes: 512, maxArtifactBytes: 256, maxEvidence: 2 })), codeIs('output_rejected'));
  }
});

test('artifact content, paths and duplicate names are bounded', async () => {
  for (const program of [
    `lumiere.artifacts.emit({name:'../secret',mimeType:'text/plain',content:'data',sourceDatasets:['ds_receivables']})`,
    `lumiere.artifacts.emit({name:'out.txt',mimeType:'text/plain',content:'x'.repeat(512),sourceDatasets:['ds_receivables']})`,
    `for(let i=0;i<2;i++) lumiere.artifacts.emit({name:'same.txt',mimeType:'text/plain',content:'x',sourceDatasets:['ds_receivables']})`,
  ]) {
    await assert.rejects(runJavaScript(input(program, { maxOutputBytes: 1024, maxArtifactBytes: 256 })), codeIs('output_rejected'));
  }
});

test('output budgets count UTF-8 bytes rather than JavaScript character length', async () => {
  await assert.rejects(runJavaScript(input(
    `lumiere.evidence.emit({kind:'unicode',value:'😀'.repeat(50),sourceDatasets:['ds_receivables']})`,
    { maxOutputBytes: 256, maxArtifactBytes: 128 },
  )), codeIs('output_rejected'));
});

test('prototype changes and toJSON callbacks cannot bypass output bounds', async () => {
  for (const program of [
    `Object.prototype.toJSON = () => 1`,
    `lumiere.evidence.emit({kind:'dump',value:{toJSON(){return 'secret'}},sourceDatasets:['ds_receivables']})`,
    `lumiere.datasets.open = () => []`,
  ]) {
    await assert.rejects(runJavaScript(input(program)), error => error instanceof JavaScriptRuntimeError);
  }
});

test('dynamic imports and returned promises do not execute host modules', async () => {
  await assert.rejects(runJavaScript(input(`return import('node:fs')`)), codeIs('async_denied'));
  await assert.rejects(runJavaScript(input(`return Promise.resolve(1)`)), codeIs('async_denied'));
});

test('guest exceptions cannot leak dataset contents through runtime errors', async () => {
  await assert.rejects(runJavaScript(input(`throw new Error(JSON.stringify(lumiere.datasets.open('ds_receivables')))`)), error => {
    assert.equal(error.code, 'execution_failed');
    assert.ok(!error.message.includes('customer'));
    assert.ok(!error.stack.includes('amount'));
    return true;
  });
});

test('invalid input and excessive caller limits fail before executing code', async () => {
  for (const request of [
    input('1', { timeoutMs: 30_001 }),
    input('1', { memoryBytes: 256 * 1024 * 1024 }),
    { program: '1', datasets: [...datasets, ...datasets] },
    { program: '1', datasets: [{ id: 'bad/path', rows: [] }] },
    { program: '1', datasets: [{ id: 'ds', rows: [undefined] }] },
  ]) await assert.rejects(runJavaScript(request), codeIs('invalid_input'));
});
