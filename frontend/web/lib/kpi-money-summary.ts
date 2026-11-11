import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';

/** Read projection shared by monetary values, currency metadata and scope admission. */
export interface KpiMoneyRow {
  id?: unknown;
  organizationId?: unknown; organization_id?: unknown;
  companyId?: unknown; company_id?: unknown;
  deletedAt?: unknown; deleted_at?: unknown;
  code?: unknown; decimalPlaces?: unknown; decimal_places?: unknown;
  value?: unknown;
  expectedRevenue?: unknown; expected_revenue?: unknown;
  companyCurrencyId?: unknown; company_currency_id?: unknown;
  currencyId?: unknown; currency_id?: unknown;
}
type Row = KpiMoneyRow;
export interface KpiMoneyScope {
  organizationId: string | number | bigint;
  companyId: string | number | bigint;
}
interface KpiMoneyInput {
  rows: readonly Row[];
  currencies: readonly Row[];
  rowsState: ModuleDataState;
  currenciesState: ModuleDataState;
  amount: (row: Row) => unknown;
  currencyId: (row: Row) => unknown;
  scope?: KpiMoneyScope;
  locale?: string;
}
export interface KpiMoneySummary {
  state: ModuleDataState;
  /** Null means unavailable; an empty ready collection has no monetary unit to assert. */
  value: string | null;
}
const partial = (): KpiMoneySummary => ({ state: { status: 'partial' }, value: null });
const id = (value: unknown) => {
  const parsed = parseStrictU64(value);
  return parsed !== undefined && parsed > 0n ? String(parsed) : undefined;
};
function amount(raw: unknown): number | null {
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** One population for figures and drill predicates; missing scope fields never imply membership. */
export function scopedKpiRows<T extends KpiMoneyRow>(rows: readonly T[], scope?: KpiMoneyScope): T[] | null {
  const organizationId = scope && id(scope.organizationId);
  const companyId = scope && id(scope.companyId);
  if (scope && (!organizationId || !companyId)) return null;
  const scoped: T[] = [];
  for (const row of rows) {
    if (row.deletedAt != null || row.deleted_at != null) continue;
    if (scope) {
      const org = id(row.organizationId ?? row.organization_id);
      const company = id(row.companyId ?? row.company_id);
      if (org && org !== organizationId || company && company !== companyId) continue;
      if (!org || !company) return null;
    }
    scoped.push(row);
  }
  return scoped;
}

/** Complete, ready monetary projections only; currency IDs remain distinct even if codes match. */
export function kpiMoneySummary(input: KpiMoneyInput): KpiMoneySummary {
  if (input.rowsState.status !== 'ready') return { state: input.rowsState, value: null };
  if (input.currenciesState.status !== 'ready') return { state: input.currenciesState, value: null };
  const rows = scopedKpiRows(input.rows, input.scope);
  if (rows === null) return partial();
  const groups = new Map<string, { code: string; decimals: number; total: number; correction: number }>();
  for (const row of rows) {
    const currencyId = id(input.currencyId(row));
    if (!currencyId) return partial();
    const currencies = input.currencies.filter((currency) => id(currency.id) === currencyId);
    if (currencies.length !== 1) return partial();
    const currency = currencies[0]!;
    const code = String(currency.code ?? '').trim().toUpperCase();
    const decimals = currency.decimalPlaces ?? currency.decimal_places;
    if (!/^[A-Z]{3}$/.test(code) || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 6) return partial();
    const value = amount(input.amount(row));
    if (value === null || !Number.isSafeInteger(Math.round(value * 10 ** decimals))) return partial();
    const group = groups.get(currencyId) ?? { code, decimals, total: 0, correction: 0 };
    // Compensated summation retains fractional inputs until the final currency rounding.
    const adjusted = value - group.correction;
    const total = group.total + adjusted;
    group.correction = (total - group.total) - adjusted;
    group.total = total;
    if (!Number.isSafeInteger(Math.round(total * 10 ** decimals))) return partial();
    groups.set(currencyId, group);
  }
  try {
    const values = [...groups.entries()].sort(([a, first], [b, second]) => first.code.localeCompare(second.code) || (BigInt(a) < BigInt(b) ? -1 : 1)).map(([, group]) =>
      new Intl.NumberFormat(input.locale ?? 'en-US', {
        style: 'currency', currency: group.code,
        minimumFractionDigits: group.decimals, maximumFractionDigits: group.decimals,
      }).format(group.total),
    );
    return { state: { status: 'ready' }, value: values.length ? values.join(' · ') : '—' };
  } catch {
    return partial();
  }
}
