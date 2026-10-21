/**
 * Which subscription actions apply in which state. Shared by the list's row actions and the
 * record page header so the two cannot drift. `null` means "any state".
 */
export type SubscriptionActionId =
  | 'activate'
  | 'pause'
  | 'resume'
  | 'close'
  | 'generate-invoice'
  | 'pay-invoice'
  | 'amend'
  | 'renew'
  | 'cancel'
  | 'ingest-usage'
  | 'rate-usage'
  | 'set-commitment'
  | 'record-failure'
  | 'advance-dunning'
  | 'refresh-flags';

/** Allowed states per action; `'not-closed'` mirrors the list's `state !== "closed"` gate. */
const GATES: Record<SubscriptionActionId, readonly string[] | 'not-closed' | null> = {
  activate: ['draft'],
  pause: ['active'],
  resume: ['paused'],
  close: 'not-closed',
  'generate-invoice': ['active'],
  'pay-invoice': ['active'],
  amend: ['active', 'paused'],
  renew: ['active', 'paused'],
  cancel: 'not-closed',
  'ingest-usage': 'not-closed',
  // The list never gated these; the record page has always hidden rating on draft/closed records.
  'rate-usage': null,
  'set-commitment': 'not-closed',
  'record-failure': 'not-closed',
  'advance-dunning': null,
  'refresh-flags': null,
};

export function isSubscriptionActionApplicable(action: SubscriptionActionId, state: string): boolean {
  const gate = GATES[action];
  if (gate === null) return true;
  if (gate === 'not-closed') return state !== 'closed';
  return gate.includes(state);
}

/** Page-only extra gate: rating a draft or closed record has nothing to rate. */
export function isSubscriptionActionApplicableOnPage(action: SubscriptionActionId, state: string): boolean {
  if (action === 'rate-usage') return state !== 'draft' && state !== 'closed';
  return isSubscriptionActionApplicable(action, state);
}

/** Header actions in display order; `primary` ones are buttons, the rest go in the More menu. */
export const SUBSCRIPTION_PAGE_ACTIONS: ReadonlyArray<{ id: SubscriptionActionId; primary: boolean }> = [
  { id: 'activate', primary: true },
  { id: 'generate-invoice', primary: true },
  { id: 'pay-invoice', primary: true },
  { id: 'resume', primary: true },
  { id: 'pause', primary: false },
  { id: 'rate-usage', primary: false },
  { id: 'ingest-usage', primary: false },
  { id: 'amend', primary: false },
  { id: 'renew', primary: false },
  { id: 'set-commitment', primary: false },
  { id: 'record-failure', primary: false },
  { id: 'advance-dunning', primary: false },
  { id: 'refresh-flags', primary: false },
  { id: 'cancel', primary: false },
  { id: 'close', primary: false },
];

export function subscriptionPageActions(state: string): Array<{ id: SubscriptionActionId; primary: boolean }> {
  return SUBSCRIPTION_PAGE_ACTIONS.filter((a) => isSubscriptionActionApplicableOnPage(a.id, state));
}
