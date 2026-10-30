import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import { AmbiguousOperationEffectError, executeOperationWithCanonicalReadback, requireResolvedOperationEffect, type CanonicalRecordRef, type ExecuteOperationWithReadbackArgs } from './operation-effect';

export interface RenewalRequest {
  idempotencyKey: string;
  intervals: number;
  notes: string;
}

/** Bind recovery to the exact generated command, rather than a parallel caller-supplied payload. */
export function requireMatchingRenewalCommand(input: unknown, request: RenewalRequest): void {
  if (!input || typeof input !== 'object') throw new Error('The renewal command is unavailable');
  const command = input as { intervals?: unknown; notes?: unknown; idempotencyKey?: unknown; idempotency_key?: unknown };
  const option = (value: unknown) => value && typeof value === 'object' && Object.hasOwn(value, 'some') ? (value as { some: unknown }).some : value;
  const key = option(command.idempotencyKey ?? command.idempotency_key);
  const rawNotes = option(command.notes);
  const notes = rawNotes == null || (typeof rawNotes === 'object' && Object.hasOwn(rawNotes, 'none')) ? '' : rawNotes;
  if (key !== request.idempotencyKey || command.intervals !== request.intervals || notes !== request.notes) {
    throw new Error('The renewal command does not match its retained request');
  }
}

interface RenewalAmendmentRow {
  id?: unknown; organizationId?: unknown; organization_id?: unknown; companyId?: unknown; company_id?: unknown;
  subscriptionId?: unknown; subscription_id?: unknown; amendmentType?: unknown; amendment_type?: unknown;
  createdBy?: unknown; created_by?: unknown; version?: unknown; metadata?: unknown; afterJson?: unknown; after_json?: unknown; notes?: unknown;
}

export interface SubscriptionRenewalEffectRef extends CanonicalRecordRef {
  resource: 'subscription-amendments';
  subscriptionId: string;
  version: number;
  nextInvoiceSeconds: string;
}

function identity(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const row = value as { __identity__?: unknown; hex?: unknown };
    value = row.__identity__ ?? row.hex;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^0x/i, '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function jsonObject(value: unknown): { idempotency_key?: unknown; request_fingerprint?: unknown; intervals?: unknown; recurring_next_date?: unknown } | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/** Exact immutable receipt, with actor and payload checks; a later billing date alone proves nothing. */
export function resolveSubscriptionRenewalEffect(
  rows: readonly RenewalAmendmentRow[], organizationId: bigint, companyId: bigint, subscriptionId: bigint,
  actorIdentity: string, request: RenewalRequest,
): SubscriptionRenewalEffectRef | null {
  const actor = identity(actorIdentity);
  if (!actor || !request.idempotencyKey.trim()) throw new Error('A scoped renewal request identity is required');
  const matches = rows.filter((row) => parseStrictU64(row.organizationId ?? row.organization_id) === organizationId
    && parseStrictU64(row.companyId ?? row.company_id) === companyId
    && parseStrictU64(row.subscriptionId ?? row.subscription_id) === subscriptionId
    && identity(row.createdBy ?? row.created_by) === actor
    && (row.amendmentType ?? row.amendment_type) === 'renew'
    && jsonObject(row.metadata)?.idempotency_key === request.idempotencyKey);
  if (matches.length > 1) throw new AmbiguousOperationEffectError('Multiple immutable renewal receipts match this request');
  const row = matches[0];
  if (!row) return null;
  const id = parseStrictU64(row.id);
  const version = Number(row.version);
  const after = jsonObject(row.afterJson ?? row.after_json);
  const fingerprint = jsonObject(row.metadata)?.request_fingerprint;
  if (after?.intervals !== request.intervals || row.notes !== request.notes) {
    throw new AmbiguousOperationEffectError('The renewal request identity is bound to different values');
  }
  if (!id || !Number.isSafeInteger(version) || version <= 0 || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)
    || !Number.isSafeInteger(after.recurring_next_date) || Number(after.recurring_next_date) <= 0) return null;
  return { resource: 'subscription-amendments', id: String(id), subscriptionId: String(subscriptionId), version, nextInvoiceSeconds: String(after.recurring_next_date) };
}

/** Interrupted/reloaded attempts only read. They must not redispatch to learn whether a renewal saved. */
export async function executeSubscriptionRenewal(
  args: ExecuteOperationWithReadbackArgs<SubscriptionRenewalEffectRef> & { reconcileOnly?: boolean },
) {
  if (args.reconcileOnly) {
    const ref = await args.resolveEffect();
    if (!ref) throw new Error('Renewal status remains unknown. Check again before starting another renewal.');
    await args.afterDispatch?.();
    return { kind: 'already-applied' as const, ref };
  }
  return requireResolvedOperationEffect(await executeOperationWithCanonicalReadback(args));
}
