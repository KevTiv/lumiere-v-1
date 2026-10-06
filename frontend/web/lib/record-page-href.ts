/** The page of a record, by the model name notes and attachments are filed under. */
const RECORD_PAGE: Record<string, (id: string) => string> = {
  sale_order: (id) => `/sales/orders/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
  account_move: (id) => `/accounting/invoices/${id}`,
  stock_picking: (id) => `/inventory/transfers/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
  document: (id) => `/documents/${id}`,
  fleet_vehicle: (id) => `/fleet/vehicles/${id}`,
  calendar_event: (id) => `/calendar/events/${id}`,
};

/** Where a record of `model` has a page of its own, or undefined when it has none. */
export function recordPageHref(model: unknown, id: unknown): string | undefined {
  const key = String(model ?? '');
  if (!key || id == null || String(id) === '') return undefined;
  return RECORD_PAGE[key]?.(String(id));
}
