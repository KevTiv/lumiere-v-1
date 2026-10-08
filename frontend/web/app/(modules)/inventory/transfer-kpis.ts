import { firstNonNullKey, type RowValueMap } from '@lumiere/erp-shared/row-values';
import { normalizedTag } from '@lumiere/erp-workflows';
import { kpiDate, type KpiContext, type KpiTileDef } from '@lumiere/ui/lib/kpi-tiles';

type Row = Record<string, unknown>;

/** Reserved and ready to ship or receive. */
export function isReadyTransfer(row: Row): boolean {
  return normalizedTag(row.state) === 'assigned';
}

/** Confirmed but waiting for stock or a preceding move. */
export function isWaitingTransfer(row: Row): boolean {
  const state = normalizedTag(row.state);
  return state === 'confirmed' || state === 'waiting';
}

/** Still moving stock, and its scheduled date has passed. */
export function isLateTransfer(row: Row, now: Date): boolean {
  if (!isReadyTransfer(row) && !isWaitingTransfer(row)) return false;
  const scheduled = kpiDate(firstNonNullKey(row as RowValueMap, 'scheduledDate', 'scheduled_date'));
  return scheduled != null && scheduled.getTime() < now.getTime();
}

/** KPI tiles for the transfers list: ready to ship, late, and waiting. */
export function transferKpis(rows: readonly Row[], ctx: KpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  return [
    {
      key: 'ready',
      label: t('inventory.kpi.ready', { defaultValue: 'Ready to ship' }),
      value: rows.filter(isReadyTransfer).length,
      tone: 'success',
      matches: isReadyTransfer,
    },
    {
      key: 'late',
      label: t('inventory.kpi.late', { defaultValue: 'Late' }),
      value: rows.filter((row) => isLateTransfer(row, now)).length,
      tone: 'destructive',
      matches: (row) => isLateTransfer(row, now),
    },
    {
      key: 'waiting',
      label: t('inventory.kpi.waiting', { defaultValue: 'Waiting' }),
      value: rows.filter(isWaitingTransfer).length,
      tone: 'warning',
      matches: isWaitingTransfer,
    },
  ];
}
