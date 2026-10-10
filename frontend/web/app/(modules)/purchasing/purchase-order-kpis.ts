import { firstNonNullKey, type RowValueMap } from '@lumiere/erp-shared/row-values';
import { normalizedTag } from '@lumiere/erp-workflows';
import { kpiDate, type KpiContext, type KpiTileDef } from '@lumiere/ui/lib/kpi-tiles';

type Row = Record<string, unknown>;

/** A request for quotation: not yet confirmed as a purchase order. */
export function isRfq(row: Row): boolean {
  const state = normalizedTag(row.state);
  return state === 'draft' || state === 'sent';
}

/** A confirmed purchase order whose goods have not all arrived. */
export function isToReceive(row: Row): boolean {
  if (normalizedTag(row.state) !== 'purchase') return false;
  return normalizedTag(firstNonNullKey(row as RowValueMap, 'receiptStatus', 'receipt_status')) !== 'full';
}

/** To receive, and the planned date has passed. */
export function isLateReceipt(row: Row, now: Date): boolean {
  if (!isToReceive(row)) return false;
  const planned = kpiDate(firstNonNullKey(row as RowValueMap, 'datePlanned', 'date_planned'));
  return planned != null && planned.getTime() < now.getTime();
}

/** KPI tiles for the purchase order list: RFQs, orders still to receive, and late receipts. */
export function purchaseOrderKpis(rows: readonly Row[], ctx: KpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  return [
    {
      key: 'rfqs',
      label: t('purchasing.kpi.rfqs', { defaultValue: 'RFQs' }),
      value: rows.filter(isRfq).length,
      tone: 'info',
      matches: isRfq,
    },
    {
      key: 'toReceive',
      label: t('purchasing.kpi.toReceive', { defaultValue: 'To receive' }),
      value: rows.filter(isToReceive).length,
      tone: 'warning',
      matches: isToReceive,
    },
    {
      key: 'late',
      label: t('purchasing.kpi.late', { defaultValue: 'Late' }),
      value: rows.filter((row) => isLateReceipt(row, now)).length,
      tone: 'destructive',
      matches: (row) => isLateReceipt(row, now),
    },
  ];
}
