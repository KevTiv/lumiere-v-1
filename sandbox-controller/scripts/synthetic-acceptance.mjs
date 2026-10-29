import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ExecutionJournal } from '../src/journal.mjs';
import { DatasetBroker } from '../src/broker.mjs';
import { SandboxController } from '../src/controller.mjs';
import { runJavaScript } from '../src/runtime/index.mjs';

// Synthetic data and an in-process provider only. This command never creates
// Railway resources, calls ERP/provider APIs, or reads deployment credentials.
const root = await mkdtemp(join(tmpdir(), 'lumiere-js-acceptance-'));
const journal = new ExecutionJournal(join(root, 'journal.sqlite'));
try {
  const scope = { actorIdentity:'synthetic-actor',organizationId:'1',companyId:'1',runId:'1',policyGeneration:'synthetic-v1' };
  const authorize = async ({scope: current}) => JSON.stringify(current) === JSON.stringify(scope);
  const broker = new DatasetBroker({store:journal,authorize});
  const dataset = await broker.issue({scope,schema:{ref:'synthetic-balances-v1',fields:[{name:'balance',type:'number'}]},
    rows:[{balance:100},{balance:200},{balance:300}],expiresAt:new Date(Date.now()+60_000).toISOString()});
  const provider = {
    profileHash:'a'.repeat(64),
    async create({onCreated}) {const handle={id:'synthetic-vm',expiresAt:Date.now()+60_000};await onCreated(handle);return handle;},
    async execute(_handle,{input,onSession,signal}) {await onSession('synthetic-session');return runJavaScript(input,{signal});},
    async destroy(){return {status:'destroyed'};},
  };
  const controller = new SandboxController({journal,broker,provider,authorize,mode:'synthetic'});
  const result = await controller.execute({scope,requestKey:randomBytes(32).toString('hex'),datasetIds:[dataset.id],profileRef:`sha256:${provider.profileHash}`,
    program:`const rows=lumiere.datasets.open(${JSON.stringify(dataset.id)});
      lumiere.evidence.emit({kind:'aggregate',value:{label:'total',value:rows.reduce((s,r)=>s+r.balance,0),count:rows.length},sourceDatasets:[${JSON.stringify(dataset.id)}]});`});
  if (result.status !== 'completed' || result.evidence[0].value.value !== 600
      || journal.getDataset(dataset.id).rows.length !== 0 || journal.listUnsettled().length !== 0) {
    throw new Error('synthetic_acceptance_failed');
  }
  console.log(JSON.stringify({status:result.status,runtime:'quickjs-wasm',evidence:result.evidence,
    temporaryDataRemoved:true,reservationsSettled:true,liveRailway:false,productionAdmitted:false}));
} finally {
  journal.close();
  await rm(root,{recursive:true,force:true});
}
