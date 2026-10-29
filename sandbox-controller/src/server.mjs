import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BUILD_ADMISSION } from './admission.mjs';
import { dispatchControllerRequest } from './dispatch.mjs';
import { createProductionServices } from './composition.mjs';

/** No environment flag or request parameter can admit customer execution. */
export function createControllerServer({ secret, maxBodyBytes = 1_310_720, createRequestServices } = {}) {
  if (typeof secret !== 'string' || secret.length < 32 || !Number.isSafeInteger(maxBodyBytes)
    || maxBodyBytes <= 0 || maxBodyBytes > 2_097_152) throw new Error('invalid_controller_configuration');
  const expected = Buffer.from(secret);
  return createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (request.url === '/health/ready' && request.method === 'GET') {
      return send(200, { ready: false, productionExecution: BUILD_ADMISSION.productionExecution,
        reason: 'sandbox_production_uncertified' });
    }
    const provided = request.headers['x-lumiere-sandbox-secret'];
    if (typeof provided !== 'string' || Buffer.byteLength(provided) !== expected.byteLength
      || !timingSafeEqual(Buffer.from(provided), expected)) return send(401, { error: 'unauthorized' });
    let bytes = 0;
    const chunks=[];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) return send(413, { error: 'request_too_large' });
        chunks.push(chunk);
      }
    } catch { return send(400, { error: 'invalid_request' }); }
    const url = new URL(request.url, 'http://controller.invalid');
    if (url.pathname === '/v1/datasets' || url.pathname === '/v1/executions'
      || /^\/v1\/executions\/[a-f0-9]{64}(\/cancel)?$/.test(url.pathname)) {
      if (!BUILD_ADMISSION.productionExecution) return send(503, { error: 'sandbox_production_uncertified' });
      if (typeof createRequestServices !== 'function') return send(503,{error:'sandbox_authority_unavailable'});
      try {
        // The factory owns current actor credentials; request bodies never
        // instantiate providers, choose URLs, or grant themselves authority.
        const body=bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
        const services=await createRequestServices(request,{url,body});
        return send(200,await dispatchControllerRequest({method:request.method,url,body,...services}));
      } catch {
        return send(403,{error:'sandbox_request_denied'});
      }
    }
    return send(404, { error: 'not_found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port');
  let services;
  if (BUILD_ADMISSION.productionExecution) {
    services=await createProductionServices({journalPath:process.env.SANDBOX_JOURNAL_PATH,
      railwayToken:process.env.SANDBOX_RAILWAY_API_TOKEN,environmentId:process.env.SANDBOX_RAILWAY_ENVIRONMENT_ID,
      region:process.env.SANDBOX_REGION,apiBaseUrl:process.env.LUMIERE_API_SERVER_URL,
      requiredCapabilities:(process.env.SANDBOX_SOURCE_CAPABILITIES??'').split(',').filter(Boolean)});
  }
  const server = createControllerServer({ secret: process.env.SANDBOX_CONTROL_SECRET,
    createRequestServices:services?.forRequest });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.listen(port, '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(()=>services?.close());
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
