/** Where a stock transfer's page lives. */
export function transferRecordHref(transfer: Record<string, unknown>): string | undefined {
  return transfer.id == null ? undefined : `/inventory/transfers/${String(transfer.id)}`;
}
