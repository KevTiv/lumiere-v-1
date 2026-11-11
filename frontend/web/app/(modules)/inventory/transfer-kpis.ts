import { firstOwnedKey } from '@lumiere/erp-shared/row-values';
import { normalizedTag } from '@lumiere/erp-workflows';
import { type KpiContext, type KpiTileDef } from '@lumiere/ui/lib/kpi-tiles';

import { moduleHistoryTimestampMs } from '@lumiere/ui/lib/module-history-filter';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';

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
  const scheduled = moduleHistoryTimestampMs(firstOwnedKey(row, 'scheduledDate', 'scheduled_date'), 'UTC', 'microseconds');
  return scheduled !== null && scheduled < now.getTime();
}

/** KPI tiles for the transfers list: ready to ship, late, and waiting. */
export function transferKpis(rows: readonly Row[], ctx: KpiContext & { sourceState: ModuleDataState }): KpiTileDef[] {
  const { t, now } = ctx;
  const datesKnown = rows.filter((row) => isReadyTransfer(row) || isWaitingTransfer(row)).every((row) =>
    moduleHistoryTimestampMs(firstOwnedKey(row, 'scheduledDate', 'scheduled_date'), 'UTC', 'microseconds') !== null,
  );
  const tiles: KpiTileDef[] = [
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
      value: datesKnown ? rows.filter((row) => isLateTransfer(row, now)).length : '—',
      hint: datesKnown ? undefined : t('inventory.kpi.deadlineUnavailable', { defaultValue: 'Required transfer dates are unavailable.' }),
      tone: 'destructive',
      matches: datesKnown ? (row) => isLateTransfer(row, now) : undefined,
    },
    {
      key: 'waiting',
      label: t('inventory.kpi.waiting', { defaultValue: 'Waiting' }),
      value: rows.filter(isWaitingTransfer).length,
      tone: 'warning',
      matches: isWaitingTransfer,
    },
  ];
  return ctx.sourceState.status === 'ready' ? tiles : tiles.map((tile) => ({
    ...tile,
    value: '—',
    matches: undefined,
    hint: t('inventory.kpi.sourceUnavailable', { defaultValue: 'Transfer data is unavailable.' }),
  }));
}
