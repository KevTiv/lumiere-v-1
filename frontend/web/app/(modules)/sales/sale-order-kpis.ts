import { firstNonNullKey, type RowValueMap } from '@lumiere/erp-shared/row-values';
import { isSaleOrderConfirmed, isSaleOrderInvoiceable, normalizedTag } from '@lumiere/erp-workflows';
import {
  currencyCodeOfRow,
  formatKpiMoney,
  formatMoneyTotals,
  isInMonthOf,
  kpiDate,
  sumByCurrency,
  type KpiContext,
  type KpiTileDef,
} from '@lumiere/ui/lib/kpi-tiles';

type Row = Record<string, unknown>;

/** Quotations still being drawn up or waiting on the customer. */
export function isQuotation(row: Row): boolean {
  const state = normalizedTag(row.state);
  return state === 'draft' || state === 'sent';
}

/** A confirmed order placed in the month of `now`. */
export function isRevenueThisMonth(row: Row, now: Date): boolean {
  return isSaleOrderConfirmed(row as RowValueMap) && isInMonthOf(kpiDate(firstNonNullKey(row as RowValueMap, 'dateOrder', 'date_order')), now);
}

/**
 * KPI tiles for the sales order list, counted from the rows it already shows: quotations, orders
 * waiting to be invoiced, and confirmed revenue this month (per currency, never summed across them).
 */
export function saleOrderKpis(rows: readonly Row[], ctx: KpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  const revenueRows = rows.filter((row) => isRevenueThisMonth(row, now));
  const revenue = sumByCurrency(
    revenueRows,
    (row) => Number(firstNonNullKey(row as RowValueMap, 'amountTotal', 'amount_total') ?? 0),
    currencyCodeOfRow(ctx.currencyCodeById, 'currencyId', 'currency_id'),
  );
  return [
    {
      key: 'quotations',
      label: t('sales.kpi.quotations', { defaultValue: 'Quotations' }),
      value: rows.filter(isQuotation).length,
      tone: 'info',
      matches: isQuotation,
    },
    {
      key: 'toInvoice',
      label: t('sales.kpi.toInvoice', { defaultValue: 'Orders to invoice' }),
      value: rows.filter((row) => isSaleOrderInvoiceable(row as RowValueMap)).length,
      tone: 'warning',
      matches: (row) => isSaleOrderInvoiceable(row as RowValueMap),
    },
    {
      key: 'revenue',
      label: t('sales.kpi.revenueThisMonth', { defaultValue: 'Revenue this month' }),
      value: formatMoneyTotals(revenue, formatKpiMoney),
      hint: t('sales.kpi.revenueOrders', { defaultValue: 'Orders: {{count}}', count: revenueRows.length }),
      tone: 'success',
      matches: (row) => isRevenueThisMonth(row, now),
    },
  ];
}
