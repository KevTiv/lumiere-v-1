/** Where a purchase order's page lives. */
export function purchaseOrderRecordHref(order: Record<string, unknown>): string | undefined {
  return order.id == null ? undefined : `/purchasing/orders/${String(order.id)}`;
}
