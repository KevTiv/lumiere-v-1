import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createLumiereApiClient, QueryResponseDecodeError, registerLumiereApiClient } from '@lumiere/api-client';
import { HttpResponseError } from '@lumiere/api-client/response-error';
import { stdbBffCommandPost } from '@lumiere/stdb/commands';
import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';
import * as http from '../http';
import * as currencies from './settings-currencies';

const originalFetch = globalThis.fetch;
const euro = { id: 1, code: 'EUR', decimalPlaces: 2 };
const yen = { id: 1, code: 'JPY', decimalPlaces: 0 };
const first = { organizationId: 7, identity: 'alice' };
const second = { organizationId: 8, identity: 'alice' };
const anotherIdentity = { organizationId: 7, identity: 'bob' };
const bootstrap = { identity: 'alice' };

beforeEach(() => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: 'http://api.test', credentials: 'omit' }));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  registerLumiereApiClient(null);
});
function respond(payload: unknown, status = 200) {
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify(payload), { status });
  };
  return requests;
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

test('a shared query client never reuses fresh currency IDs across organizations, identities or bootstrap', async () => {
  const client = queryClient();
  const optionsA = currencies.currenciesQueryOptions(first);
  const optionsB = currencies.currenciesQueryOptions(second);
  const optionsOtherUser = currencies.currenciesQueryOptions(anotherIdentity);
  const optionsBootstrap = currencies.currenciesQueryOptions(bootstrap);
  const observer = new QueryObserver(client, optionsA);
  try {
    const callsA = respond({ data: [euro] });
    await client.fetchQuery(optionsA);
    observer.setOptions(optionsA);
    assert.deepEqual(observer.getCurrentResult().data, [euro]);
    assert.equal(callsA.length, 1);

    for (const options of [optionsB, optionsOtherUser, optionsBootstrap]) {
      observer.setOptions(options);
      assert.equal(observer.getCurrentResult().data, undefined, 'old currency metadata must disappear before the new read');
      assert.equal(client.getQueryData(options.queryKey), undefined);
    }
    const callsB = respond({ data: [yen] });
    await client.fetchQuery(optionsB);
    assert.deepEqual(callsB, ['http://api.test/api/bootstrap/currencies']);
    assert.deepEqual(client.getQueryData(optionsA.queryKey), [euro]);
    assert.deepEqual(client.getQueryData(optionsB.queryKey), [yen]);
    assert.equal(optionsA.staleTime, 300_000);

    await client.invalidateQueries({ queryKey: ['currencies'] });
    assert.equal(client.getQueryState(optionsA.queryKey)?.isInvalidated, true);
    assert.equal(client.getQueryState(optionsB.queryKey)?.isInvalidated, true);
    assert.notDeepEqual(currencies.currenciesQueryKey({ organizationId: 9007199254740992n, identity: 'alice' }), currencies.currenciesQueryKey({ organizationId: 9007199254740993n, identity: 'alice' }));
  } finally {
    observer.destroy();
    client.clear();
  }
});

test('a late previous-organization read cannot overwrite the current catalog', async () => {
  const client = queryClient();
  let finishOld: ((response: Response) => void) | undefined;
  globalThis.fetch = () => new Promise<Response>((resolve) => { finishOld = resolve; });
  try {
    const pending = client.fetchQuery(currencies.currenciesQueryOptions(first));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(finishOld);
    respond({ data: [yen] });
    await client.fetchQuery(currencies.currenciesQueryOptions(second));
    finishOld(new Response(JSON.stringify({ data: [euro] })));
    await pending;
    assert.deepEqual(client.getQueryData(currencies.currenciesQueryKey(second)), [yen]);
    assert.deepEqual(client.getQueryData(currencies.currenciesQueryKey(first)), [euro]);
  } finally {
    client.clear();
  }
});

test('authenticated pre-tenant bootstrap data remains usable and isolated from tenant IDs', async () => {
  const catalog = [{ id: 0, code: 'EUR', decimalPlaces: 2 }, { id: 0, code: 'JPY', decimalPlaces: 0 }];
  respond({ data: catalog, additionalOrganizationCode: null });
  assert.deepEqual(await currencies.currenciesQueryOptions(bootstrap).queryFn(), catalog);
  respond({ data: catalog, additionalOrganizationCode: 'approved-new-tenant' });
  assert.deepEqual(await currencies.fetchCurrencies(), catalog);
  assert.notDeepEqual(currencies.currenciesQueryKey(bootstrap), currencies.currenciesQueryKey(first));
});

test('malformed successful responses fail instead of becoming an empty currency read', async () => {
  const malformed = [
    null, [], {}, { data: null }, { data: {} }, { data: [null] }, { data: [[]] },
    { data: [{}] }, { data: [{ id: 1, code: 'EUR' }] },
    { data: [{ id: 1, code: 'EUR', decimalPlaces: '2' }] },
    { data: [{ id: 1, code: 'EURO', decimalPlaces: 2 }] },
    { data: [{ id: 1.1, code: 'EUR', decimalPlaces: 2 }] },
    { data: [{ id: '1_0', code: 'EUR', decimalPlaces: 2 }] },
    { data: [euro, euro] }, { data: [], complete: false },
    { data: [], additionalOrganizationCode: 4 },
  ];
  for (const payload of malformed) {
    respond(payload);
    await assert.rejects(currencies.fetchCurrencies(), QueryResponseDecodeError);
  }
  respond({ data: [] });
  assert.deepEqual(await currencies.fetchCurrencies(), []);
  globalThis.fetch = async () => new Response('{invalid json');
  await assert.rejects(currencies.fetchCurrencies(), SyntaxError);
});

test('HTTP authorization and server failures retain their status for readiness classification', async () => {
  for (const status of [401, 403, 409, 503]) {
    respond({ detail: 'Currency access failed' }, status);
    await assert.rejects(currencies.fetchCurrencies(), (error: unknown) => {
      assert.ok(error instanceof HttpResponseError);
      assert.equal(error.status, status);
      assert.equal(error.message, 'Currency access failed');
      return true;
    });
  }
  respond(null, 403);
  await assert.rejects(currencies.fetchCurrencies(), (error: unknown) => error instanceof HttpResponseError && error.status === 403);
  globalThis.fetch = async () => { throw new Error('network unavailable'); };
  await assert.rejects(currencies.fetchCurrencies(), /network unavailable/);
});

test('useCurrencies passes the current ERP session to the scoped options on each render', () => {
  const session: { organizationId?: number; identity: string | null } = { ...first };
  const dependencies = {
    '@lumiere/stdb/commands': { stdbBffCommandPost },
    '../http': http,
    '@lumiere/erp-shared/stdb-params-json': { stdbParamsToJson },
    '@lumiere/erp-session': { useErpSession: () => session },
    './settings-currencies': currencies,
    '@tanstack/react-query': { useQuery: (options: unknown) => options },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./settings.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as { useCurrencies(): ReturnType<typeof currencies.currenciesQueryOptions> } };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name as keyof typeof dependencies];
    },
  });
  assert.deepEqual(module.exports.useCurrencies().queryKey, currencies.currenciesQueryKey(first));
  session.organizationId = second.organizationId;
  assert.deepEqual(module.exports.useCurrencies().queryKey, currencies.currenciesQueryKey(second));
  session.identity = anotherIdentity.identity;
  assert.deepEqual(module.exports.useCurrencies().queryKey, currencies.currenciesQueryKey({ ...second, identity: 'bob' }));
  session.organizationId = undefined;
  session.identity = null;
  assert.deepEqual(module.exports.useCurrencies().queryKey, currencies.currenciesQueryKey({ identity: null }));
});
