const SCOPE_FIELDS = ['actorIdentity','organizationId','companyId','runId','policyGeneration'];

function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key=>!keys.includes(key))
    || keys.some(key=>!Object.hasOwn(value,key))) {
    const error=new Error('invalid_request');error.code='invalid_request';throw error;
  }
}

/**
 * Internal protocol dispatcher. The HTTP host must authenticate, apply build
 * admission and supply services bound to the caller's current credentials.
 * Direct use by synthetic acceptance does not grant production admission.
 */
export async function dispatchControllerRequest({method,url,body,broker,controller}) {
  if (method==='POST' && url.pathname==='/v1/datasets') {
    return {dataset:await broker.issue(body)};
  }
  if (method==='POST' && url.pathname==='/v1/executions') {
    fields(body,['scope','requestKey','program','datasetIds','profileRef']);
    return {execution:await controller.execute(body)};
  }
  const match=/^\/v1\/executions\/([a-f0-9]{64})(\/cancel)?$/.exec(url.pathname);
  if (match && method==='POST' && match[2]) {
    fields(body,['scope']);
    return {execution:await controller.cancel({scope:body.scope,requestKey:match[1]})};
  }
  if (match && method==='GET' && !match[2]) {
    const scope=Object.fromEntries(url.searchParams);
    if ([...url.searchParams].length!==SCOPE_FIELDS.length) fields({},SCOPE_FIELDS);
    fields(scope,SCOPE_FIELDS);
    return {execution:await controller.reconcile({scope,requestKey:match[1]})};
  }
  const error=new Error('not_found');error.code='not_found';throw error;
}
