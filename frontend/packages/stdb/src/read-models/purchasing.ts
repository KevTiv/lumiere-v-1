/** Loose row shape from `/api/query/purchase-orders` (and similar purchasing lists). */
export type PurchasingQueryRow = Record<string, unknown>;

/** Primary label for purchase order rows (name / reference / partner). */
export function purchaseOrderPrimaryLabel(row: PurchasingQueryRow): string {
  return primaryLabel([row.name, row.reference, row.partnerName, row.vendorName], row.id);
}
import { primaryLabel } from "./primary-label";
