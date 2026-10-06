type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Lower-cased state of an enum cell (`{ tag }`, `{ Active: [] }`) or plain string. */
export function subscriptionStateOf(row: Record<string, unknown>): string {
  const value = row.state;
  if (typeof value === 'string') return value.toLowerCase();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('tag' in value && typeof (value as { tag: unknown }).tag === 'string') {
      return (value as { tag: string }).tag.toLowerCase();
    }
    const keys = Object.keys(value);
    if (keys.length === 1) return keys[0]!.toLowerCase();
  }
  return '';
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
