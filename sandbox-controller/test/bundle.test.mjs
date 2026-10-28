import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeProfile } from '../src/bundle.mjs';

test('production bundle contains real runner and only locked guest dependency, never controller SDK', async()=>{
  const profile=await loadRuntimeProfile({region:'eu-west4-drams3a'});
  assert.equal(profile.networkIsolation,'ISOLATED');
  assert.match(profile.digest,/^[a-f0-9]{64}$/);
  assert.match(profile.runtimeFiles['src/runtime/worker.mjs'],/quickjs-emscripten/);
  const lock=JSON.parse(profile.runtimeFiles['package-lock.json']);
  assert.equal(lock.packages['node_modules/railway'],undefined);
  assert.equal(lock.packages['node_modules/quickjs-emscripten'].version,'0.32.0');
  assert.equal((await loadRuntimeProfile({region:'eu-west4-drams3a'})).digest,profile.digest);
});
