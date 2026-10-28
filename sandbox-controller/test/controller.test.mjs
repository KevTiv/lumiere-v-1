import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ExecutionJournal } from '../src/journal.mjs';
import { DatasetBroker } from '../src/broker.mjs';
import { SandboxController } from '../src/controller.mjs';
import { runJavaScript } from '../src/runtime/index.mjs';
import { dispatchControllerRequest } from '../src/dispatch.mjs';

const SCOPE = { actorIdentity: 'synthetic-actor', organizationId: '1', companyId: '2', runId: '3', policyGeneration: 'policy-v1' };
const key = () => randomBytes(32).toString('hex');
const rows = [{ amount: 10 }, { amount: 20 }, { amount: 30 }];
const programFor = (id) => `
  const rows = lumiere.datasets.open(${JSON.stringify(id)});
  const value = {label:'total',value:rows.reduce((sum,row)=>sum+row.amount,0),count:rows.length};
  lumiere.evidence.emit({kind:'aggregate',value,sourceDatasets:[${JSON.stringify(id)}]});
  lumiere.artifacts.emit({name:'summary.json',mimeType:'application/json',
    content:JSON.stringify({kind:'aggregate',value}),sourceDatasets:[${JSON.stringify(id)}]});
`;

async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lumiere-sandbox-'));
  let journal = new ExecutionJournal(join(root, 'journal.sqlite'));
  let allowed = true;
  const authorize = async () => allowed;
  const broker = new DatasetBroker({ store: journal, authorize });
  const handle = await broker.issue({ scope: SCOPE, schema: {ref:'balances-v1',fields:[{name:'amount',type:'number'}]},
    rows, expiresAt: new Date(Date.now()+60_000).toISOString(), sourceCapabilities:['finance.balance.read'] });
  const calls = {create:0,execute:0,destroy:0,reconcile:0};
  let output;
  const provider = {
    profileHash: 'a'.repeat(64),
    async create({onCreated}) { calls.create++; const h={id:'synthetic-vm',expiresAt:Date.now()+60_000}; await onCreated(h); return h; },
    async execute(_handle,{input,onSession,signal}) { calls.execute++; await onSession('synthetic-session'); output=await runJavaScript(input,{signal}); return output; },
    async destroy() { calls.destroy++; return {status:'destroyed'}; },
    async reconcile() { calls.reconcile++; return {status:'completed',output}; },
    ...overrides.provider,
  };
  const controller = new SandboxController({ journal, broker, provider, authorize, mode:'synthetic', ...overrides.controller });
  t.after(async()=>{journal.close();await rm(root,{recursive:true,force:true});});
  return {journal,broker,handle,calls,provider,controller,authorize,root,
    deny(){allowed=false;}, request(){return {scope:SCOPE,requestKey:key(),program:programFor(handle.id),datasetIds:[handle.id],profileRef:`sha256:${provider.profileHash}`};},
    reopen(){journal.close();journal=new ExecutionJournal(join(root,'journal.sqlite'));return journal;}};
}

test('actual JS -> broker -> durable evidence/artifact -> cleanup survives SQLite reopen',async t=>{
  const f=await setup(t);const req=f.request();
  const result=await f.controller.execute(req);
  assert.equal(result.status,'completed');
  assert.deepEqual(result.evidence[0].value,{label:'total',value:60,count:3});
  assert.equal(result.artifacts.length,1);
  assert.equal(f.journal.getArtifact(SCOPE,result.artifacts[0].sha256).content,result.artifacts[0].content);
  assert.deepEqual(f.journal.getDataset(f.handle.id).rows,[]);
  assert.equal(f.journal.getDataset(f.handle.id).revoked,true);
  assert.equal(f.journal.listUnsettled().length,0);
  assert.equal(f.calls.destroy,1);
  const reopened=f.reopen();
  assert.equal(reopened.getExecution(req.requestKey).status,'completed');
  assert.deepEqual(reopened.getDataset(f.handle.id).rows,[]);
});

test('internal Rust-compatible protocol dispatches a full synthetic dataset/run/readback',async t=>{
  const f=await setup(t);const req=f.request();
  const call=(method,path,body)=>dispatchControllerRequest({method,url:new URL(path,'http://controller.invalid'),body,broker:f.broker,controller:f.controller});
  const issued=await call('POST','/v1/datasets',{scope:SCOPE,schema:{ref:'empty-v1',fields:[{name:'amount',type:'number'}]},rows:[],expiresAt:new Date(Date.now()+60_000).toISOString()});
  assert.equal(issued.dataset.rowCount,0);
  const result=await call('POST','/v1/executions',req);
  assert.equal(result.execution.status,'completed');
  const inspected=await call('GET',`/v1/executions/${req.requestKey}?${new URLSearchParams(SCOPE)}`);
  assert.deepEqual(inspected,result);
  await assert.rejects(call('POST','/v1/executions',{...req,mode:'synthetic'}),{code:'invalid_request'});
});

test('idempotent execution never creates another sandbox and changed input conflicts',async t=>{
  const f=await setup(t);const req=f.request();
  await f.controller.execute(req);
  assert.equal((await f.controller.execute(req)).status,'completed');
  await assert.rejects(f.controller.execute({...req,program:req.program+';0;'}),{code:'execution_identity_conflict'});
  assert.equal(f.calls.create,1);assert.equal(f.calls.execute,1);
});

test('current authorization and exact scope protect saved output readback',async t=>{
  const f=await setup(t);const req=f.request();await f.controller.execute(req);
  await assert.rejects(f.controller.inspect({scope:{...SCOPE,companyId:'9'},requestKey:req.requestKey}),{code:'execution_not_found'});
  f.deny();
  await assert.rejects(f.controller.inspect({scope:SCOPE,requestKey:req.requestKey}),{code:'authorization_denied'});
  await assert.rejects(f.controller.execute(f.request()),{code:'authorization_denied'});
});

test('unknown dispatch retains reservation and reconciles without executing twice',async t=>{
  let saved;
  const f=await setup(t,{provider:{async execute(_h,{input,onSession}){await onSession('known-session');saved=await runJavaScript(input);const e=new Error();e.outcomeUnknown=true;throw e;},
    async reconcile(){return {status:'completed',output:saved};}}});
  const req=f.request();
  assert.equal((await f.controller.execute(req)).status,'outcome_unknown');
  assert.equal(f.journal.listUnsettled().length,1);
  assert.equal((await f.controller.execute(req)).status,'outcome_unknown');
  const replacement=new SandboxController({journal:f.journal,broker:f.broker,provider:f.provider,authorize:f.authorize,mode:'synthetic'});
  assert.equal((await replacement.reconcile({scope:SCOPE,requestKey:req.requestKey})).status,'completed');
  assert.equal(f.calls.create,1);assert.equal(f.journal.listUnsettled().length,0);
});

test('output stays withheld while teardown is uncertain; restart retries only teardown',async t=>{
  let failing=true;
  const f=await setup(t,{provider:{async destroy(){if(failing)throw new Error('private provider text');return {status:'destroyed'};}}});
  const req=f.request();const result=await f.controller.execute(req);
  assert.equal(result.status,'cleanup_pending');assert.equal(result.evidence,undefined);
  assert.equal(f.journal.listUnsettled().length,1);
  failing=false;
  const replacement=new SandboxController({journal:f.journal,broker:f.broker,provider:f.provider,authorize:f.authorize,mode:'synthetic'});
  assert.equal((await replacement.reconcile({scope:SCOPE,requestKey:req.requestKey})).status,'completed');
  assert.equal(f.calls.execute,1);
});

test('revoked export cannot turn successful guest execution into released evidence',async t=>{
  const f=await setup(t);const original=f.provider.execute;
  f.provider.execute=async(...args)=>{const output=await original(...args);f.deny();return output;};
  const result=await f.controller.execute(f.request());
  assert.equal(result.status,'failed');assert.equal(result.evidence,undefined);
  assert.deepEqual(f.journal.getDataset(f.handle.id).rows,[]);
});

test('unknown VM creation cannot be retried or silently release compute admission',async t=>{
  const f=await setup(t,{provider:{async create(){throw new Error('transport lost');}}});
  const req=f.request();
  assert.equal((await f.controller.execute(req)).status,'outcome_unknown');
  assert.equal((await f.controller.execute(req)).status,'outcome_unknown');
  assert.equal(f.journal.listUnsettled().length,1);
});

test('production execution remains unavailable despite synthetic mode in request or environment',async t=>{
  const f=await setup(t);const controller=new SandboxController({journal:f.journal,broker:f.broker,provider:f.provider,authorize:f.authorize});
  process.env.LUMIERE_SANDBOX_ENABLED='true';
  t.after(()=>delete process.env.LUMIERE_SANDBOX_ENABLED);
  await assert.rejects(controller.execute({...f.request(),mode:'synthetic'}),{code:'sandbox_production_uncertified'});
  assert.equal(f.calls.create,0);
});

test('a run cannot claim a runtime profile different from the pinned provider',async t=>{
  const f=await setup(t);
  await assert.rejects(f.controller.execute({...f.request(),profileRef:'sha256:'+ 'b'.repeat(64)}),{code:'runtime_profile_mismatch'});
  assert.equal(f.calls.create,0);
});

test('revocation during VM creation blocks dataset upload and program dispatch',async t=>{
  const f=await setup(t);const original=f.provider.create;
  f.provider.create=async(...args)=>{const h=await original(...args);f.journal.revokeDataset(f.handle.id);return h;};
  const result=await f.controller.execute(f.request());
  assert.equal(result.status,'failed');assert.equal(f.calls.execute,0);assert.equal(f.calls.destroy,1);
});

test('cancellation while export authorization waits cannot release evidence',async t=>{
  const f=await setup(t);let release;let entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const broker=new DatasetBroker({store:f.journal,authorize:async({operation})=>{
    if(operation==='export'){entered();await gate;}return true;
  }});
  const controller=new SandboxController({journal:f.journal,broker,provider:f.provider,authorize:f.authorize,mode:'synthetic'});
  const req=f.request();const pending=controller.execute(req);
  await waiting;await controller.cancel({scope:SCOPE,requestKey:req.requestKey});release();
  const result=await pending;
  assert.equal(result.status,'cancelled');assert.equal(result.evidence,undefined);
  assert.equal(f.journal.listUnsettled().length,0);
});

test('finalization atomically settles original reservation even after configuration changes',()=>{
  const journal=new ExecutionJournal(':memory:');
  try{
    const record={requestKey:key(),scope:SCOPE,requestHash:'a',status:'cleanup_pending',createdAt:new Date().toISOString()};
    journal.claimExecution(record,{maxConcurrent:1,maxCpuMsPerDay:100,reservedCpuMs:60});
    journal.finalizeExecution(record.requestKey,{status:'completed'});
    assert.equal(journal.listUnsettled().length,0);
    assert.equal(journal.getExecution(record.requestKey).status,'completed');
    journal.finalizeExecution(record.requestKey,{status:'completed'});
    assert.throws(()=>journal.claimExecution({...record,requestKey:key()},{maxConcurrent:1,maxCpuMsPerDay:100,reservedCpuMs:60}),{code:'sandbox_compute_budget_exhausted'});
  }finally{journal.close();}
});

test('identical artifact bytes can have separate names without corrupting content identity',()=>{
  const journal=new ExecutionJournal(':memory:');
  try{
    const artifact={sha256:'a'.repeat(64),mimeType:'application/json',content:'{}',bytes:2};
    journal.putArtifact(SCOPE,{...artifact,name:'first.json',sourceDatasets:['one']});
    journal.putArtifact(SCOPE,{...artifact,name:'second.json',sourceDatasets:['two']});
    assert.equal(journal.getArtifact(SCOPE,artifact.sha256).content,'{}');
  }finally{journal.close();}
});

test('concurrent recovery observers cannot downgrade a completed execution',async t=>{
  let output;
  const f=await setup(t,{provider:{async execute(_h,{input,onSession}){await onSession('known');output=await runJavaScript(input);const error=new Error();error.outcomeUnknown=true;throw error;},
    async reconcile(){return {status:'completed',output};}}});
  const req=f.request();await f.controller.execute(req);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});let count=0;
  const broker=new DatasetBroker({store:f.journal,authorize:async({operation})=>{
    if(operation==='export' && ++count===2){await gate;}return true;
  }});
  const first=new SandboxController({journal:f.journal,broker,provider:f.provider,authorize:f.authorize,mode:'synthetic'});
  const second=new SandboxController({journal:f.journal,broker,provider:f.provider,authorize:f.authorize,mode:'synthetic'});
  // Hold the second observer after it read valid handles but before its fresh
  // authorization finishes. The first observer then finalizes and revokes.
  let releaseFirst;let firstEntered;
  const firstWaiting=new Promise(resolve=>{firstEntered=resolve;});
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  const original=broker.validateOutput.bind(broker);
  broker.validateOutput=async value=>{if(count===0){firstEntered();await firstGate;}return original(value);};
  const a=first.reconcile({scope:SCOPE,requestKey:req.requestKey});await firstWaiting;
  const b=second.reconcile({scope:SCOPE,requestKey:req.requestKey});
  // Let the first observer finish; terminal monotonicity must also withstand
  // a later explicit stale finalization from a different process.
  releaseFirst();
  const resultA=await a;
  // Either observer may be first through authorization; release any held one.
  release();
  await b;
  assert.equal(resultA.status,'completed');
  f.journal.finalizeExecution(req.requestKey,{status:'failed'});
  assert.equal(f.journal.getExecution(req.requestKey).status,'completed');
});

test('SQLite admission independently bounds concurrency, daily compute, identity and expiry purge',()=>{
  const journal=new ExecutionJournal(':memory:');
  try{
    const record={requestKey:key(),scope:SCOPE,requestHash:'a',status:'accepted',createdAt:new Date().toISOString()};
    const limits={maxConcurrent:1,maxCpuMsPerDay:100,reservedCpuMs:60};
    journal.claimExecution(record,limits);
    assert.throws(()=>journal.claimExecution({...record,requestKey:key()},limits),{code:'sandbox_concurrency_exhausted'});
    assert.throws(()=>journal.claimExecution({...record,scope:{...SCOPE,runId:'4'}},limits),{code:'execution_identity_conflict'});
    journal.settleExecution(record.requestKey,60);
    assert.throws(()=>journal.claimExecution({...record,requestKey:key()},limits),{code:'sandbox_compute_budget_exhausted'});
    journal.putDataset({id:'expired',expiresAt:new Date(0).toISOString(),rows:[{private:'value'}]});
    assert.equal(journal.purgeExpiredDatasets(),1);assert.deepEqual(journal.getDataset('expired').rows,[]);
  }finally{journal.close();}
});
