import { firstNonNullKey, firstOwnedKey, type RowValueMap } from '@lumiere/erp-shared/row-values';
import {
  type KpiContext,
  type KpiTileDef,
} from '@lumiere/ui/lib/kpi-tiles';

import { moduleHistoryTimestampMs } from '@lumiere/ui/lib/module-history-filter';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';
import { kpiMoneySummary, scopedKpiRows, type KpiMoneyScope } from '../../../lib/kpi-money-summary';

type Row = Record<string, unknown>;
interface OpportunityKpiContext extends Pick<KpiContext, 't' | 'now' | 'locale'> {
  currencyRows: readonly Row[];
  sourceState: ModuleDataState;
  currencyState: ModuleDataState;
  scope?: KpiMoneyScope;
}

/** An opportunity that is neither won nor lost nor deleted. */
export function isOpenOpportunity(row: Row): boolean {
  return firstNonNullKey(row as RowValueMap, 'isWon', 'is_won') === false && firstNonNullKey(row as RowValueMap, 'isLost', 'is_lost') === false && firstNonNullKey(row as RowValueMap, 'deletedAt', 'deleted_at') == null;
}

/** Open, with a closing deadline that has passed. */
export function isOverdueOpportunity(row: Row, now: Date): boolean {
  if (!isOpenOpportunity(row)) return false;
  const deadline = moduleHistoryTimestampMs(firstOwnedKey(row, 'dateDeadline', 'date_deadline'), 'UTC', 'microseconds');
  return deadline !== null && deadline < now.getTime();
}

/**
 * KPI tiles for the opportunity list: open opportunities, their expected revenue (per currency,
 * never summed across them) and the ones past their deadline.
 */
export function opportunityKpis(rows: readonly Row[], ctx: OpportunityKpiContext): KpiTileDef[] {
  const { t, now } = ctx;
  // An explicitly unassigned opportunity belongs to the organization, not this company's pipeline.
  const assignedToCompany = (row: Row) => !ctx.scope || (row.companyId !== null && row.company_id !== null);
  const scoped = scopedKpiRows(rows.filter(assignedToCompany), ctx.scope);
  const population = scoped ?? [];
  const matchesScope = (row: Row) => assignedToCompany(row) && scopedKpiRows([row], ctx.scope)?.length === 1;
  const open = population.filter(isOpenOpportunity);
  const openMatches = (row: Row) => matchesScope(row) && isOpenOpportunity(row);
  const outcomesKnown = scoped !== null && population.every((row) => {
    const won = firstNonNullKey(row as RowValueMap, 'isWon', 'is_won');
    const lost = firstNonNullKey(row as RowValueMap, 'isLost', 'is_lost');
    return typeof won === 'boolean' && typeof lost === 'boolean' && !(won && lost);
  });
  const sourceState: ModuleDataState = ctx.sourceState.status === 'ready' && !outcomesKnown
    ? { status: 'partial' } : ctx.sourceState;
  const sourceReady = sourceState.status === 'ready';
  const deadlinesKnown = open.every((row) => {
    const deadline = firstOwnedKey(row, 'dateDeadline', 'date_deadline');
    return deadline === null || moduleHistoryTimestampMs(deadline, 'UTC', 'microseconds') !== null;
  });
  const overdueReady = sourceReady && deadlinesKnown;
  const expected = kpiMoneySummary({
    rows: open,
    currencies: ctx.currencyRows,
    rowsState: sourceState,
    currenciesState: ctx.currencyState,
    amount: (row) => firstNonNullKey(row as RowValueMap, 'expectedRevenue', 'expected_revenue'),
    currencyId: (row) => firstNonNullKey(row as RowValueMap, 'companyCurrencyId', 'company_currency_id'),
    scope: ctx.scope,
    locale: ctx.locale,
  });
  return [
    {
      key: 'open',
      label: t('crm.kpi.open', { defaultValue: 'Open opportunities' }),
      value: sourceReady ? open.length : '—',
      tone: 'info',
      matches: sourceReady ? openMatches : undefined,
    },
    {
      key: 'expectedRevenue',
      label: t('crm.kpi.expectedRevenue', { defaultValue: 'Expected revenue' }),
      value: expected.value ?? '—',
      hint: expected.state.status === 'ready' ? undefined : t(expected.state.status === 'loading' ? 'crm.kpi.expectedRevenueLoading' : 'crm.kpi.expectedRevenueUnavailable', {
        defaultValue: expected.state.status === 'loading' ? 'Revenue or currency data is loading.' : 'Required revenue or currency data is unavailable.',
      }),
      tone: 'success',
      matches: expected.state.status === 'ready' ? openMatches : undefined,
    },
    {
      key: 'overdue',
      label: t('crm.kpi.overdue', { defaultValue: 'Past deadline' }),
      value: overdueReady ? population.filter((row) => isOverdueOpportunity(row, now)).length : '—',
      hint: sourceReady && !deadlinesKnown ? t('crm.kpi.deadlineUnavailable', { defaultValue: 'Required opportunity deadlines are unavailable.' }) : undefined,
      tone: 'destructive',
      matches: overdueReady ? (row) => matchesScope(row) && isOverdueOpportunity(row, now) : undefined,
    },
  ];
}
