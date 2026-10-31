import type { RenewalRequest } from '@lumiere/query-hooks/hooks/subscription-renewal';

export interface RenewalAttemptScope { actor: string; organizationId: string; companyId: string; subscriptionId: string }
export interface RenewalAttempt extends RenewalRequest {
  scope: RenewalAttemptScope;
  phase: 'submitting' | 'unknown' | 'rejected';
}
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageKey(scope: RenewalAttemptScope): string {
  if (!/^[a-f0-9]{64}$/i.test(scope.actor) || ![scope.organizationId, scope.companyId, scope.subscriptionId].every((value) => /^[1-9]\d*$/.test(value))) {
    throw new Error('The authenticated renewal scope is unavailable');
  }
  return `lumiere.subscription-renewal.${scope.actor.toLowerCase()}.${scope.organizationId}.${scope.companyId}.${scope.subscriptionId}`;
}

function browserStorage(): RecoveryStorage {
  if (typeof window === 'undefined') throw new Error('Renewal recovery storage is unavailable');
  return window.localStorage;
}

/** Strict reads are intentional: malformed or inaccessible checkpoints must never start another renewal. */
export function readRenewalAttempt(scope: RenewalAttemptScope, storage: RecoveryStorage = browserStorage()): RenewalAttempt | null {
  const key = storageKey(scope);
  const raw = storage.getItem(key);
  if (raw == null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The retained renewal request is invalid');
  const value = parsed as Partial<RenewalAttempt>;
  if (!value.scope || storageKey(value.scope) !== key || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()
    || value.idempotencyKey.length > 200 || typeof value.notes !== 'string'
    || !Number.isSafeInteger(value.intervals) || Number(value.intervals) < 1 || Number(value.intervals) > 4294967295
    || !['submitting', 'unknown', 'rejected'].includes(String(value.phase))) throw new Error('The retained renewal request is invalid');
  return value as RenewalAttempt;
}

export function retainRenewalAttempt(scope: RenewalAttemptScope, request: RenewalRequest, phase: RenewalAttempt['phase'], storage: RecoveryStorage = browserStorage(), replaceRejected = false): RenewalAttempt {
  const previous = readRenewalAttempt(scope, storage);
  if (previous && !(replaceRejected && previous.phase === 'rejected')
    && (previous.idempotencyKey !== request.idempotencyKey || previous.intervals !== request.intervals || previous.notes !== request.notes)) {
    throw new Error('Resolve the retained renewal before starting a different request');
  }
  const attempt = { ...request, scope, phase };
  storage.setItem(storageKey(scope), JSON.stringify(attempt));
  return attempt;
}

/** Only a verified exact receipt may clear an uncertain write checkpoint. */
export function completeRenewalAttempt(scope: RenewalAttemptScope, key: string, storage: RecoveryStorage = browserStorage()): void {
  const attempt = readRenewalAttempt(scope, storage);
  if (attempt?.idempotencyKey === key) storage.removeItem(storageKey(scope));
}

export function renewalScope(actor: string | null, organizationId: bigint, companyId: bigint, subscriptionId: bigint): RenewalAttemptScope {
  return { actor: (actor ?? '').replace(/^0x/i, '').toLowerCase(), organizationId: String(organizationId), companyId: String(companyId), subscriptionId: String(subscriptionId) };
}
