interface Row { [field: string]: unknown }
const field = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake];
const tag = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' && 'tag' in value ? String(value.tag) : '';
function finite(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
/** Presentation eligibility follows exact producer-owned relations; reducer checks remain authoritative. */
export function billLineCorrectionSource(bill: Row, line: Row, orders: readonly Row[], sources: readonly Row[]): Row | undefined {
  if (tag(bill.state) !== 'Draft' || tag(field(bill, 'moveType', 'move_type')) !== 'InInvoice' || field(bill, 'postedBefore', 'posted_before') !== false || (finite(field(bill, 'amountTax', 'amount_tax')) ?? -1) < 0) return;
  if (bill.id == null || field(bill, 'companyId', 'company_id') == null || field(bill, 'currencyId', 'currency_id') == null || field(bill, 'companyCurrencyId', 'company_currency_id') == null) return;
  if (String(field(line, 'moveId', 'move_id')) !== String(bill.id) || String(field(line, 'companyId', 'company_id')) !== String(field(bill, 'companyId', 'company_id')) || field(line, 'productId', 'product_id') == null) return;
  const origin = field(bill, 'invoiceOrigin', 'invoice_origin');
  const owners = orders.filter((o) => origin === `PO${String(o.id)}` && String(field(o, 'companyId', 'company_id')) === String(field(bill, 'companyId', 'company_id')) && Array.isArray(field(o, 'invoiceIds', 'invoice_ids')) && (field(o, 'invoiceIds', 'invoice_ids') as unknown[]).filter((id) => String(id) === String(bill.id)).length === 1);
  if (owners.length !== 1) return;
  const candidates = sources.filter((p) => Array.isArray(field(p, 'invoiceLines', 'invoice_lines')) && (field(p, 'invoiceLines', 'invoice_lines') as unknown[]).some((id) => String(id) === String(line.id)));
  if (candidates.length !== 1) return;
  const source = candidates[0];
  if (String(field(source, 'orderId', 'order_id')) !== String(owners[0].id) || String(field(source, 'companyId', 'company_id')) !== String(field(bill, 'companyId', 'company_id')) || String(field(source, 'productId', 'product_id')) !== String(field(line, 'productId', 'product_id'))) return;
  return source;
}
export function billLineCorrectionParams(line: Row, values: Row, companyId: bigint) {
  const quantity = finite(values.quantity);
  const priceUnit = finite(values.priceUnit);
  const expectedQuantity = finite(line.quantity);
  const expectedPriceUnit = finite(field(line, 'priceUnit', 'price_unit'));
  if (quantity == null || quantity <= 0 || priceUnit == null || priceUnit < 0 || expectedQuantity == null || expectedQuantity <= 0 || expectedPriceUnit == null || expectedPriceUnit < 0 || !Number.isFinite(quantity * priceUnit)) throw new Error('Enter a finite positive quantity and a finite non-negative unit price.');
  return { companyId, quantity, priceUnit, expectedQuantity, expectedPriceUnit };
}
