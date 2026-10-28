import { requireProductionAdmission } from './admission.mjs';
import { ExecutionJournal } from './journal.mjs';
import { DatasetBroker } from './broker.mjs';
import { SandboxController } from './controller.mjs';
import { createActorAuthorizer } from './authority.mjs';
import { loadRuntimeProfile } from './bundle.mjs';
import { RailwaySandboxProvider } from './provider.mjs';

/**
 * Deployment-owned composition, available only after reviewed build admission.
 * No HTTP payload supplies a provider, credential, filesystem path or API URL.
 */
export async function createProductionServices({ journalPath, railwayToken, environmentId,
  region, apiBaseUrl, requiredCapabilities, limits }) {
  requireProductionAdmission();
  const profile = await loadRuntimeProfile({region});
  const provider = new RailwaySandboxProvider({token:railwayToken,environmentId,profile});
  const journal = new ExecutionJournal(journalPath);
  // Maintenance only destroys expired owned resources and removes temporary
  // rows; this deny-all authorizer can never release data or start execution.
  const cleanupAuthority = async()=>false;
  const maintenance = new SandboxController({journal,provider,limits,
    broker:new DatasetBroker({store:journal,authorize:cleanupAuthority}),authorize:cleanupAuthority});
  let pending;
  const timer = setInterval(()=>{
    if (pending) return;
    pending=maintenance.reapExpired().catch(()=>{}).finally(()=>{pending=undefined;});
  },1_000);
  timer.unref();
  return {
    async forRequest(request,{url,body}) {
      const scope=request.method==='GET' ? Object.fromEntries(url.searchParams) : body?.scope;
      const authorization=request.headers.authorization;
      if (typeof authorization!=='string' || !authorization.startsWith('Bearer ')
        || request.headers['x-stdb-identity']!==scope?.actorIdentity) throw new Error('actor_credentials_required');
      const authorize=createActorAuthorizer({apiBaseUrl,actorToken:authorization.slice(7),scope,requiredCapabilities});
      const broker=new DatasetBroker({store:journal,authorize});
      const controller=new SandboxController({journal,broker,provider,authorize,limits});
      return {broker,controller};
    },
    async close() {clearInterval(timer);if(pending)await pending;journal.close();},
  };
}
