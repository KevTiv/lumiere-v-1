import { field, idOf, isRowActive, numberOf, textOf, type ReadRow } from '@/lib/row-field';

export interface CommissionSplitRow {
  id: string;
  partner: string | null;
  sharePercent: number | null;
}

export interface CommissionPlanRow {
  id: string;
  name: string | null;
  isActive: boolean;
  defaultRatePercent: number | null;
  splitCount: number;
  /** Total of the splits' share percentages (null when the plan has none). */
  splitTotalPercent: number | null;
  splits: CommissionSplitRow[];
}

export interface SaleOrderOptionRow {
  id: string;
  product: string | null;
  description: string | null;
  quantity: number | null;
  priceUnit: number | null;
  discount: number | null;
  /** Quantity x unit price after the discount percentage, when all three are known. */
  subtotal: number | null;
  isPresent: boolean;
}

/** Plans (newest id first) with their splits grouped by plan; split partners come from the partner lookup. */
export function commissionPlanRows(
  plans: ReadonlyArray<ReadRow>,
  splits: ReadonlyArray<ReadRow>,
  partnerNameById: ReadonlyMap<string, string>,
): CommissionPlanRow[] {
  const splitsByPlan = new Map<string, CommissionSplitRow[]>();
  for (const split of splits) {
    const planId = idOf(split, 'planId');
    if (planId == null) continue;
    const partnerId = idOf(split, 'partnerId');
    const list = splitsByPlan.get(planId) ?? [];
    list.push({
      id: String(field(split, 'id')),
      partner: partnerId != null ? (partnerNameById.get(partnerId) ?? null) : null,
      sharePercent: numberOf(split, 'sharePercent'),
    });
    splitsByPlan.set(planId, list);
  }
  return [...plans]
    .sort((a, b) => Number(field(b, 'id') ?? 0) - Number(field(a, 'id') ?? 0))
    .map((plan) => {
      const id = String(field(plan, 'id'));
      const planSplits = splitsByPlan.get(id) ?? [];
      const shares = planSplits.map((s) => s.sharePercent).filter((n): n is number => n != null);
      return {
        id,
        name: textOf(plan, 'name'),
        isActive: isRowActive(plan, 'isActive'),
        defaultRatePercent: numberOf(plan, 'defaultRatePercent'),
        splitCount: planSplits.length,
        splitTotalPercent: shares.length > 0 ? Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100 : null,
        splits: planSplits,
      };
    });
}

/** Optional products offered on one sale order. Unnamed products stay empty (no raw ids). */
export function optionRowsForOrder(
  orderId: unknown,
  options: ReadonlyArray<ReadRow>,
  productNameById: ReadonlyMap<string, string>,
): SaleOrderOptionRow[] {
  if (orderId == null) return [];
  const wanted = String(orderId);
  return options
    .filter((option) => idOf(option, 'orderId') === wanted)
    .map((option) => {
      const productId = idOf(option, 'productId');
      const quantity = numberOf(option, 'quantity');
      const priceUnit = numberOf(option, 'priceUnit');
      const discount = numberOf(option, 'discount');
      const subtotal =
        quantity != null && priceUnit != null
          ? Math.round(quantity * priceUnit * (1 - (discount ?? 0) / 100) * 100) / 100
          : null;
      return {
        id: String(field(option, 'id')),
        product: productId != null ? (productNameById.get(productId) ?? null) : null,
        description: textOf(option, 'name'),
        quantity,
        priceUnit,
        discount,
        subtotal,
        isPresent: field(option, 'isPresent') === true,
      };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export interface CommissionSplitListRow extends CommissionSplitRow {
  plan: string | null;
}

/** Every split with the name of its plan, plan order preserved. */
export function commissionSplitListRows(plans: ReadonlyArray<CommissionPlanRow>): CommissionSplitListRow[] {
  return plans.flatMap((plan) => plan.splits.map((split) => ({ ...split, plan: plan.name })));
}
