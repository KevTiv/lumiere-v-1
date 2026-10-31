import { useCallback, useEffect, useRef, useState } from 'react';
import { useErpSession } from '@lumiere/erp-session';
import { fetchQueryList } from '../http';
import { exactRecordCreationResult, readPendingRecordCreation, recordCreationStorageKey, type ConfigurableCreationModel, type PendingRecordCreation } from './record-creation-invocation';

const resources = { crm_lead: 'lead-creations', opportunity: 'opportunity-creations', contact: 'contact-creations', sale_order: 'quotation-creations' } as const;
export interface CreationRecoveryAccess { model: ConfigurableCreationModel; canRead: boolean }
export interface CreationRecoveryItem {
  model: ConfigurableCreationModel;
  pending?: PendingRecordCreation;
  status: 'pending' | 'unknown' | 'saved' | 'unavailable' | 'denied';
  recordId?: string;
}

function accessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  return [401, 403, 404, 410].includes(Number(error.status));
}

/** Discover retained creates without executing them. Scope lifetimes invalidate late reads, including A -> B -> A. */
export function useRecordCreationRecovery(organizationId: bigint, companyId: bigint, models: readonly CreationRecoveryAccess[], refreshKey?: string | number | boolean) {
  const { identity } = useErpSession();
  const actorHex = identity?.replace(/^0x/i, '').toLowerCase() ?? '';
  const allowed = models.filter((model) => model.canRead).map((model) => model.model);
  const stamp = `${organizationId}:${companyId}:${actorHex}:${allowed.join(',')}`;
  const live = useRef({ stamp, mounted: false, denied: new Set<ConfigurableCreationModel>() });
  if (live.current.stamp !== stamp) live.current = { stamp, mounted: false, denied: new Set() };
  const lifetime = live.current;
  const [state, setState] = useState<{ lifetime: typeof lifetime; items: CreationRecoveryItem[]; busy: boolean }>();
  const validScope = /^[a-f0-9]{64}$/.test(actorHex) && organizationId > 0n && companyId > 0n;
  const assertScope = useCallback(() => {
    if (live.current !== lifetime || !lifetime.mounted) throw new Error('Creation recovery scope changed');
  }, [lifetime]);
  const scope = { organizationId, companyId, actorHex };
  const scan = useCallback(() => {
    if (!validScope || !lifetime.mounted || live.current !== lifetime || typeof window === 'undefined') return;
    const items: CreationRecoveryItem[] = [];
    for (const model of allowed) {
      if (lifetime.denied.has(model)) { items.push({ model, status: 'denied' }); continue; }
      try {
        const pending = readPendingRecordCreation(scope, model, window.localStorage);
        if (pending) items.push({ model, pending, status: 'pending' });
      } catch { items.push({ model, status: 'unavailable' }); }
    }
    setState({ lifetime, items, busy: false });
    // `stamp` binds the complete primitive scope and allowed-model set.
  }, [lifetime, validScope]);
  useEffect(() => {
    lifetime.mounted = true;
    scan();
    window.addEventListener('focus', scan);
    window.addEventListener('storage', scan);
    return () => { lifetime.mounted = false; window.removeEventListener('focus', scan); window.removeEventListener('storage', scan); };
  }, [lifetime, scan]);
  useEffect(() => { scan(); }, [refreshKey, scan]);

  const check = async (model: ConfigurableCreationModel, finish = false, expectedKey?: string) => {
    assertScope();
    if (!validScope || !allowed.includes(model)) return;
    setState((previous) => ({ lifetime, items: previous?.lifetime === lifetime ? previous.items : [], busy: true }));
    try {
      if (!navigator.locks) throw new Error('Browser request coordination is unavailable');
      await navigator.locks.request(recordCreationStorageKey(scope, model), async () => {
        assertScope();
        const pending = readPendingRecordCreation(scope, model, window.localStorage);
        if (!pending || (expectedKey && pending.operationKey !== expectedKey)) throw new Error('The retained creation request changed');
        const query = new URLSearchParams({ companyId: String(companyId), operationKey: pending.operationKey });
        const rows = await fetchQueryList(`/api/query/${resources[model]}?${query}`, 'The saved record could not be checked');
        assertScope();
        const recordId = exactRecordCreationResult(pending, rows);
        lifetime.denied.delete(model);
        if (finish && recordId) {
          // An explicit review acknowledgement may clear only this exact, freshly reauthorized receipt.
          window.localStorage.removeItem(recordCreationStorageKey(scope, model));
          setState((previous) => ({ lifetime, items: (previous?.lifetime === lifetime ? previous.items : []).filter((item) => item.model !== model), busy: false }));
          return;
        }
        setState((previous) => ({ lifetime, items: [
          ...(previous?.lifetime === lifetime ? previous.items : []).filter((item) => item.model !== model),
          { model, pending, status: recordId ? 'saved' : 'unknown', recordId },
        ], busy: false }));
      });
    } catch (error) {
      if (live.current !== lifetime || !lifetime.mounted) return;
      const denied = accessDenied(error);
      if (denied) lifetime.denied.add(model);
      setState((previous) => ({ lifetime, items: [
        ...(previous?.lifetime === lifetime ? previous.items : []).filter((item) => item.model !== model),
        { model, status: denied ? 'denied' : 'unavailable', ...(!denied ? { pending: previous?.lifetime === lifetime ? previous.items.find((item) => item.model === model)?.pending : undefined } : {}) },
      ], busy: false }));
    }
  };
  return { items: state?.lifetime === lifetime && validScope ? state.items : [], busy: state?.lifetime === lifetime && state.busy, check, scan, scopeStamp: stamp };
}
