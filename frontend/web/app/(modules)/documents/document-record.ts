type Row = Record<string, unknown>;

/** Where a document's page lives. */
export function documentRecordHref(document: Row): string | undefined {
  return document.id == null ? undefined : `/documents/${String(document.id)}`;
}

const LINKED_PAGE: Record<string, (id: string) => string> = {
  sale_order: (id) => `/sales/orders/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
  account_move: (id) => `/accounting/invoices/${id}`,
  stock_picking: (id) => `/inventory/transfers/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
};

/** The page of the record a document is attached to, when that record has one. */
export function linkedRecordHref(document: Row): string | undefined {
  const model = String(document.resModel ?? document.res_model ?? '');
  const id = document.resId ?? document.res_id;
  if (!model || id == null) return undefined;
  return LINKED_PAGE[model]?.(String(id));
}

/** Plain-language size: 1536 → "1.5 KB". */
export function formatFileSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
