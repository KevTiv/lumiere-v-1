import { entityEnumTag } from "@lumiere/ui/lib/entity-row-values";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Lower-cased state of an enum cell (`{ tag }`, `{ Active: [] }`) or plain string. */
export function subscriptionStateOf(row: { state?: unknown }): string {
  return entityEnumTag(row.state)?.toLowerCase() ?? '';
}

/**
 * Where a subscription is, for the status bar: draft → active → closed, with a paused stage
 * between active and closed only while it is paused.
 */
export function subscriptionStatusBar(
  subscription: Record<string, unknown>,
  t: Translate,
): { steps: Array<{ id: string; label: string }>; current: string } {
  const state = subscriptionStateOf(subscription);
  const steps = [
    { id: 'draft', label: t('subscriptions.subscriptions.states.draft', { defaultValue: 'Draft' }) },
    { id: 'active', label: t('subscriptions.subscriptions.states.active', { defaultValue: 'Active' }) },
    ...(state === 'paused'
      ? [{ id: 'paused', label: t('subscriptions.subscriptions.states.paused', { defaultValue: 'Paused' }) }]
      : []),
    { id: 'closed', label: t('subscriptions.subscriptions.states.closed', { defaultValue: 'Closed' }) },
  ];
  return { steps, current: state };
}
