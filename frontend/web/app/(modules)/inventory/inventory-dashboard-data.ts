import { getRowField, type RowValueMap } from '@lumiere/erp-shared/row-values';
import { inventoryQuantity } from '@lumiere/erp-shared/replenishment-stock';
import { parseStrictU64 } from '@lumiere/erp-shared/u64';
import { normalizedTag } from '@lumiere/erp-workflows';
import { moduleHistoryTimestampMs } from '@lumiere/ui/lib/module-history-filter';

export function inventoryStockValue(
  quants: readonly RowValueMap[],
  currencyCodes: ReadonlyMap<string, string>,
  companyCurrency: string | undefined,
  locale?: string,
): string {
  const byCurrency = new Map<string, number>();
  for (const quant of quants) {
    const value = inventoryQuantity(getRowField(quant, 'value'));
    const rawCurrency = getRowField(quant, 'currencyId');
    const currencyId = parseStrictU64(rawCurrency);
    const currency = currencyId != null
      ? currencyCodes.get(String(currencyId))
      : rawCurrency === null || (rawCurrency != null && typeof rawCurrency === 'object' && 'none' in rawCurrency)
        ? companyCurrency
        : undefined;
    if (value == null || !currency || !/^[A-Z]{3}$/.test(currency)) return '—';
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + value);
  }
  if (byCurrency.size === 0 && companyCurrency && /^[A-Z]{3}$/.test(companyCurrency)) {
    byCurrency.set(companyCurrency, 0);
  }
  return [...byCurrency].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount),
  ).join(' · ') || '—';
}

export function stockCategoriesByProduct(
  products: readonly RowValueMap[],
  categories: readonly RowValueMap[],
): Map<string, string> {
  const categoryById = new Map(categories.map((category) => [String(category.id), category.name]));
  const result = new Map<string, string>();
  for (const product of products) {
    const category = categoryById.get(String(getRowField(product, 'categId')));
    if (typeof category === 'string' && category.trim()) result.set(String(product.id), category);
  }
  return result;
}

export function inventoryCategoryCounts(
  quants: readonly RowValueMap[],
  categoryByProduct: ReadonlyMap<string, string>,
  unavailableLabel: string,
): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const quant of quants) {
    const category = categoryByProduct.get(String(getRowField(quant, 'productId'))) ?? unavailableLabel;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts].map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value);
}

export function completedTransferCounts(
  transfers: readonly RowValueMap[],
  range: { startMs: number; endMs: number },
): { period: string; In: number; Out: number; Internal: number }[] {
  const spanDays = (range.endMs - range.startMs) / 86_400_000;
  const keyLength = spanDays > 730 ? 4 : spanDays > 35 ? 7 : 10;
  const groups = new Map<string, { period: string; In: number; Out: number; Internal: number }>();
  for (const transfer of transfers) {
    if (normalizedTag(transfer.state) !== 'done') continue;
    const timestamp = moduleHistoryTimestampMs(getRowField(transfer, 'dateDone'), 'UTC', 'microseconds');
    if (timestamp == null || timestamp < range.startMs || timestamp >= range.endMs) continue;
    const code = normalizedTag(getRowField(transfer, 'pickingCode'));
    const direction = code === 'incoming' ? 'In' : code === 'outgoing' ? 'Out' : code === 'internal' ? 'Internal' : undefined;
    if (!direction) continue;
    const period = new Date(timestamp).toISOString().slice(0, keyLength);
    const group = groups.get(period) ?? { period, In: 0, Out: 0, Internal: 0 };
    group[direction]++;
    groups.set(period, group);
  }
  return [...groups.values()].sort((left, right) => left.period.localeCompare(right.period));
}
