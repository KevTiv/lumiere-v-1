import { variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Where a POS session's page lives. */
export function posSessionHref(session: Row): string | undefined {
  return session.id == null ? undefined : `/pos/sessions/${String(session.id)}`;
}

/** New → opening control → open → closing control → closed. */
export function posSessionStatusBar(
  session: Row,
  t: Translate,
): { steps: Array<{ id: string; label: string }>; current: string } {
  return {
    steps: [
      { id: 'newsession', label: t('pos.session.states.new', { defaultValue: 'New' }) },
      { id: 'openingcontrol', label: t('pos.session.states.openingControl', { defaultValue: 'Opening control' }) },
      { id: 'opened', label: t('pos.session.states.opened', { defaultValue: 'Open' }) },
      { id: 'closingcontrol', label: t('pos.session.states.closingControl', { defaultValue: 'Closing control' }) },
      { id: 'closed', label: t('pos.session.states.closed', { defaultValue: 'Closed' }) },
    ],
    current: variantTag(session.state).toLowerCase().replace(/[^a-z]/g, ''),
  };
}

/** A session can be closed or recounted until it is closed. */
export function isPosSessionOpen(session: Row): boolean {
  const state = variantTag(session.state).toLowerCase();
  return state === 'opened' || state === 'closingcontrol' || state === 'openingcontrol';
}

/** Cash counted at close minus cash at open, when the session has been counted. */
export function cashDifference(session: Row): number | null {
  const start = Number(session.cashRegisterBalanceStart ?? session.cash_register_balance_start);
  const end = Number(session.cashRegisterBalanceEndReal ?? session.cash_register_balance_end_real);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) * 100) / 100;
}
