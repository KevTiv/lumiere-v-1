import { firstNonNullKey, type RowValueMap } from '@lumiere/erp-shared/row-values';
import {
  currencyCodeOfRow,
  formatKpiMoney,
  formatMoneyTotals,
  kpiDate,
  sumByCurrency,
  type KpiContext,
  type KpiTileDef,
} from '@lumiere/ui/lib/kpi-tiles';

type Row = Record<string, unknown>;

const flag = (row: Row, ...keys: string[]) => Boolean(firstNonNullKey(row as RowValueMap, ...keys));

/** An opportunity that is neither won nor lost nor deleted. */
export function isOpenOpportunity(row: Row): boolean {
  return !flag(row, 'isWon', 'is_won') && !flag(row, 'isLost', 'is_lost') && firstNonNullKey(row as RowValueMap, 'deletedAt', 'deleted_at') == null;
}

/** Open, with a closing deadline that has passed. */
export function isOverdueOpportunity(row: Row, now: Date): boolean {
  if (!isOpenOpportunity(row)) return false;
  const deadline = kpiDate(firstNonNullKey(row as RowValueMap, 'dateDeadline', 'date_deadline'));
  return deadline != null && deadline.getTime() < now.getTime();
}

/**
 * KPI tiles for the opportunity list: open opportunities, their expected revenue (per currency,
 * never summed across them) and the ones past their deadline.
 */
export function opportunityKpis(rows: readonly Row[], ctx: KpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  const open = rows.filter(isOpenOpportunity);
  const expected = sumByCurrency(
    open,
    (row) => Number(firstNonNullKey(row as RowValueMap, 'expectedRevenue', 'expected_revenue') ?? 0),
    currencyCodeOfRow(ctx.currencyCodeById, 'companyCurrencyId', 'company_currency_id'),
  );
  return [
    {
      key: 'open',
      label: t('crm.kpi.open', { defaultValue: 'Open opportunities' }),
      value: open.length,
      tone: 'info',
      matches: isOpenOpportunity,
    },
    {
      key: 'expectedRevenue',
      label: t('crm.kpi.expectedRevenue', { defaultValue: 'Expected revenue' }),
      value: formatMoneyTotals(expected, formatKpiMoney),
      tone: 'success',
      matches: isOpenOpportunity,
    },
    {
      key: 'overdue',
      label: t('crm.kpi.overdue', { defaultValue: 'Past deadline' }),
      value: rows.filter((row) => isOverdueOpportunity(row, now)).length,
      tone: 'destructive',
      matches: (row) => isOverdueOpportunity(row, now),
    },
  ];
}
