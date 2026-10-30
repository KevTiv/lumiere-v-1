import { kpiDate } from '@lumiere/ui/lib/kpi-tiles';
import { subscriptionStateOf } from './subscription-status';
import { inSubscriptionScope, type SubscriptionScope, type WorkflowRow } from './subscription-workflow';

interface LifecycleRow extends WorkflowRow {
  closeDate?: unknown; close_date?: unknown;
  amendmentType?: unknown; amendment_type?: unknown;
  effectiveDate?: unknown; effective_date?: unknown;
  version?: unknown;
}

/** The native contract records a closure timestamp, not a planned contractual end date. */
export interface SubscriptionLifecycle {
  nextInvoiceDate: Date | null;
  closedAt: Date | null;
  closure: 'recorded' | 'not-closed' | 'unavailable';
  renewal: 'available' | 'not-active' | 'unavailable';
  renewalHistory: 'recorded' | 'none-recorded' | 'unavailable';
  lastRenewal: { id: string; version: number; effectiveDate: Date } | null;
}

function timestamp(value: unknown): Date | null {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'some')) {
    return kpiDate((value as { some: unknown }).some);
  }
  return kpiDate(value);
}

/** Use current contract state and the immutable, scoped amendment ledger; never client metadata. */
export function subscriptionLifecycle(
  subscription: LifecycleRow,
  amendments: readonly LifecycleRow[],
  scope: SubscriptionScope,
  amendmentsReady: boolean,
): SubscriptionLifecycle {
  const unavailable: SubscriptionLifecycle = {
    nextInvoiceDate: null, closedAt: null, closure: 'unavailable', renewal: 'unavailable',
    renewalHistory: 'unavailable', lastRenewal: null,
  };
  if (!inSubscriptionScope(subscription, scope)) return unavailable;
  const state = subscriptionStateOf(subscription);
  const closedAt = timestamp(subscription.closeDate ?? subscription.close_date);
  const result: SubscriptionLifecycle = {
    ...unavailable,
    nextInvoiceDate: timestamp(subscription.recurringNextDate ?? subscription.recurring_next_date),
    closedAt,
    closure: closedAt ? 'recorded' : ['draft', 'active', 'paused'].includes(state) ? 'not-closed' : 'unavailable',
    renewal: ['active', 'paused'].includes(state) ? 'available' : ['draft', 'closed'].includes(state) ? 'not-active' : 'unavailable',
  };
  if (!amendmentsReady) return result;
  const ownAmendments = amendments.filter((row) => inSubscriptionScope(row, scope)
    && String(row.subscriptionId ?? row.subscription_id) === String(subscription.id));
  // A field-masked ledger cannot establish the absence of a renewal.
  if (ownAmendments.some((row) => typeof (row.amendmentType ?? row.amendment_type) !== 'string')) return result;
  const renewals = ownAmendments.filter((row) => (row.amendmentType ?? row.amendment_type) === 'renew');
  if (!renewals.length) return { ...result, renewalHistory: 'none-recorded' };
  const decoded = renewals.map((row) => ({
    id: String(row.id ?? ''), version: Number(row.version), effectiveDate: timestamp(row.effectiveDate ?? row.effective_date),
  }));
  if (decoded.some((row) => !/^[1-9]\d*$/.test(row.id) || !Number.isSafeInteger(row.version) || row.version <= 0 || !row.effectiveDate)) return result;
  decoded.sort((a, b) => b.version - a.version);
  // Duplicate versions are inconsistent evidence, rather than an arbitrary tie-break.
  if (new Set(decoded.map((row) => row.version)).size !== decoded.length) return result;
  const latest = decoded[0]!;
  return { ...result, renewalHistory: 'recorded', lastRenewal: { ...latest, effectiveDate: latest.effectiveDate! } };
}
