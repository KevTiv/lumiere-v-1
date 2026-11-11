import { QueryResponseDecodeError, type QueryRow, type QueryRows } from '@lumiere/api-client';
import { HttpResponseError, httpResponseError } from '@lumiere/api-client/response-error';
import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import type { ErpSessionState } from '@lumiere/erp-session';
import { apiFetch } from '../http';

export interface CurrencySessionScope {
  organizationId?: ErpSessionState['organizationId'] | string | bigint;
  identity: ErpSessionState['identity'];
}

/** IDs and metadata are tenant-local; onboarding and signed-in identities get separate caches. */
export function currenciesQueryKey(scope: CurrencySessionScope) {
  return ['currencies', 'catalog-v2', scope.organizationId == null ? 'bootstrap' : String(scope.organizationId), scope.identity ?? null] as const;
}

interface CurrencyEnvelope { data?: unknown; additionalOrganizationCode?: unknown }
interface CurrencyProjection { id?: unknown; code?: unknown; decimalPlaces?: unknown; decimal_places?: unknown }

/** Admit only the documented tenant/bootstrap envelope and complete currency projections. */
export function decodeCurrenciesResponse(payload: unknown): QueryRows {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new QueryResponseDecodeError('Currency response must be an object.');
  const envelope = payload as CurrencyEnvelope;
  if (Object.keys(envelope).some((key) => key !== 'data' && key !== 'additionalOrganizationCode') || !Array.isArray(envelope.data)) {
    throw new QueryResponseDecodeError('Currency response must contain a data array.');
  }
  if (envelope.additionalOrganizationCode != null && typeof envelope.additionalOrganizationCode !== 'string') {
    throw new QueryResponseDecodeError('Invalid currency bootstrap metadata.');
  }
  const ids = new Set<string>();
  return envelope.data.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QueryResponseDecodeError(`Invalid currency row ${index}.`);
    const row = value as CurrencyProjection;
    const rawId = row.id;
    if ((typeof rawId !== 'number' && typeof rawId !== 'bigint' && (typeof rawId !== 'string' || !/^\d+$/.test(rawId)))) {
      throw new QueryResponseDecodeError(`Invalid currency ID in row ${index}.`);
    }
    const id = parseStrictU64(rawId);
    const code = row.code;
    const decimals = row.decimalPlaces ?? row.decimal_places;
    if (id === undefined || typeof code !== 'string' || !/^[A-Z]{3}$/i.test(code) || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
      throw new QueryResponseDecodeError(`Incomplete currency metadata in row ${index}.`);
    }
    // The pre-tenant bootstrap catalog intentionally gives every code id=0.
    if (id > 0n && ids.has(String(id))) throw new QueryResponseDecodeError('Duplicate currency IDs.');
    if (id > 0n) ids.add(String(id));
    return value as QueryRow;
  });
}

export async function fetchCurrencies(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = apiFetch,
): Promise<QueryRows> {
  const response = await fetcher('/api/bootstrap/currencies');
  if (!response.ok) {
    throw await httpResponseError(response, 'Failed to load currencies').catch(() => new HttpResponseError(response.status, 'Failed to load currencies'));
  }
  return decodeCurrenciesResponse(await response.json());
}

export function currenciesQueryOptions(scope: CurrencySessionScope) {
  return {
    queryKey: currenciesQueryKey(scope),
    queryFn: () => fetchCurrencies(),
    staleTime: 5 * 60_000,
  };
}
