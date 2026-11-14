import { purchaseOrderRecordPageHref } from "@lumiere/erp-shared/record-links"
/** Where a purchase order's page lives. */
export function purchaseOrderRecordHref(order: Record<string, unknown>): string | undefined {
  return order.id == null ? undefined : purchaseOrderRecordPageHref(String(order.id));
}
