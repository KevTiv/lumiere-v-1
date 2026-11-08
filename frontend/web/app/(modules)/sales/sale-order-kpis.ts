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
export function isConfirmedOrderThisMonth(row: Row, now: Date): boolean {
  return isSaleOrderConfirmed(row as RowValueMap) && isInMonthOf(kpiDate(firstNonNullKey(row as RowValueMap, 'dateOrder', 'date_order')), now);
}

/**
 * KPI tiles for the sales order list, counted from the rows it already shows: quotations, orders
 * waiting to be invoiced, and confirmed order value this month (per currency, never summed across them).
 */
export function saleOrderKpis(rows: readonly Row[], ctx: KpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  const confirmedRows = rows.filter((row) => isConfirmedOrderThisMonth(row, now));
  const amountOf = (row: Row): number => {
    const amount = firstNonNullKey(row as RowValueMap, 'amountTotal', 'amount_total');
    if (typeof amount !== 'number' && typeof amount !== 'string') return Number.NaN;
    return typeof amount === 'string' && !amount.trim() ? Number.NaN : Number(amount);
  };
  const missingAmounts = confirmedRows.filter((row) => !Number.isFinite(amountOf(row))).length;
  const currencyOf = currencyCodeOfRow(ctx.currencyCodeById, 'currencyId', 'currency_id');
  const hasKnownCurrency = (row: Row) => /^[A-Za-z]{3}$/.test(currencyOf(row));
  const unresolvedCurrencies = confirmedRows.filter((row) => Number.isFinite(amountOf(row)) && !hasKnownCurrency(row)).length;
  // Missing currency projections must not combine unrelated monetary units into one bare total.
  const orderValue = sumByCurrency(
    confirmedRows.filter(hasKnownCurrency),
    amountOf,
    currencyOf,
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
      // Retain the existing selection key for saved list state.
      key: 'revenue',
      label: t('sales.kpi.revenueThisMonth', { defaultValue: 'Confirmed order value this month' }),
      value: formatMoneyTotals(orderValue, (amount, code) => formatKpiMoney(amount, code, ctx.locale)),
      hint: [
        t('sales.kpi.revenueOrders', { defaultValue: 'Confirmed orders: {{count}} · Current calendar month', count: confirmedRows.length }),
        missingAmounts > 0 ? t('sales.kpi.missingAmounts', { defaultValue: '{{count}} orders have no valid amount', count: missingAmounts }) : null,
        unresolvedCurrencies > 0 ? t('sales.kpi.unresolvedCurrencies', { defaultValue: '{{count}} orders excluded because their currency is unavailable', count: unresolvedCurrencies }) : null,
      ].filter(Boolean).join(' · '),
      tone: 'success',
      matches: (row) => isConfirmedOrderThisMonth(row, now),
    },
  ];
}
