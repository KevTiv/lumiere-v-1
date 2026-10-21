import { firstNonNullKey, type RowValueMap } from '@lumiere/erp-shared/row-values';
import { normalizedTag } from '@lumiere/erp-workflows';
import { kpiDate, type KpiContext, type KpiTileDef } from '@lumiere/ui/lib/kpi-tiles';

type Row = Record<string, unknown>;

/** A ticket that is neither closed nor cancelled. */
export function isOpenTicket(row: Row): boolean {
  const state = normalizedTag(row.state);
  return state === 'new' || state === 'inprogress' || state === 'onhold';
}

/** Open, with an SLA deadline that passed before the SLA was reached. */
export function isSlaBreached(row: Row, now: Date): boolean {
  if (!isOpenTicket(row)) return false;
  if (firstNonNullKey(row as RowValueMap, 'slaReached', 'sla_reached')) return false;
  const deadline = kpiDate(firstNonNullKey(row as RowValueMap, 'slaDeadline', 'sla_deadline'));
  return deadline != null && deadline.getTime() < now.getTime();
}

/** KPI tiles for the ticket list: open tickets and breached SLAs. */
export function ticketKpis(rows: readonly Row[], ctx: KpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  return [
    {
      key: 'open',
      label: t('helpdesk.kpi.open', { defaultValue: 'Open tickets' }),
      value: rows.filter(isOpenTicket).length,
      tone: 'info',
      matches: isOpenTicket,
    },
    {
      key: 'slaBreached',
      label: t('helpdesk.kpi.slaBreached', { defaultValue: 'SLA breached' }),
      value: rows.filter((row) => isSlaBreached(row, now)).length,
      tone: 'destructive',
      matches: (row) => isSlaBreached(row, now),
    },
  ];
}
