import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createControllerServer } from '../src/server.mjs';
import { createProductionServices } from '../src/composition.mjs';

test('deployment composition refuses admission before credentials or volume are used',async()=>{
  await assert.rejects(createProductionServices({}),{code:'sandbox_production_uncertified'});
});

test('HTTP requires a dedicated secret and never admits executable or dataset traffic',async t=>{
  const secret='synthetic-test-secret-'.repeat(3);
  const server=createControllerServer({secret,maxBodyBytes:100});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const ready=await fetch(`${base}/health/ready`);
  assert.equal((await ready.json()).productionExecution,false);
  assert.equal((await fetch(`${base}/v1/datasets`,{method:'POST',body:'{}'})).status,401);
  const headers={'x-lumiere-sandbox-secret':secret};
  for(const path of ['/v1/datasets','/v1/executions',`/v1/executions/${'a'.repeat(64)}/cancel`]){
    assert.equal((await fetch(base+path,{method:'POST',headers,body:'{"mode":"synthetic","enabled":true}'})).status,503);
  }
  assert.equal((await fetch(`${base}/v1/executions`,{method:'POST',headers,body:'x'.repeat(101)})).status,413);
  assert.equal((await fetch(`${base}/unknown`,{headers})).status,404);
});
