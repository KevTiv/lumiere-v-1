interface CompanyProjection {
  companyId?: unknown;
  company_id?: unknown;
}
interface InvoiceProjection extends CompanyProjection { id?: unknown }
interface InvoiceLineProjection extends InvoiceProjection {
  moveId?: unknown; move_id?: unknown;
  excludeFromInvoiceTab?: unknown; exclude_from_invoice_tab?: unknown;
  taxLineId?: unknown; tax_line_id?: unknown;
  displayType?: unknown; display_type?: unknown;
  sequence?: unknown; name?: unknown; quantity?: unknown; discount?: unknown;
  priceUnit?: unknown; price_unit?: unknown;
  priceSubtotal?: unknown; price_subtotal?: unknown;
}
interface CurrencyProjection { currencyId?: unknown; currency_id?: unknown }
interface CurrencyCatalogProjection { id?: unknown; code?: unknown }

/** Unknown/redacted amounts are different from a known zero. */
export function invoiceRecordAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** Record links may outlive a company switch; never resolve a document from another company. */
export function resolveInvoiceRecord<T extends InvoiceProjection>(rows: readonly T[], moveId: string, companyId: bigint): T | undefined {
  const matches = rows.filter((row) => String(row.id) === moveId && sameCompany(row, companyId));
  return matches.length === 1 ? matches[0] : undefined;
}

export function sameCompany(row: CompanyProjection, companyId: bigint): boolean {
  return String(row.companyId ?? row.company_id ?? '') === String(companyId);
}

export function invoiceRecordLines<T extends InvoiceLineProjection>(rows: readonly T[], moveId: string, companyId: bigint): T[] {
  return rows.filter((row) => String(row.moveId ?? row.move_id ?? '') === moveId && sameCompany(row, companyId));
}

/** Invoice paper contains commercial lines, not their receivable/payable or tax ledger entries. */
export function invoiceDocumentLines(lines: readonly InvoiceLineProjection[]) {
  return lines
    .filter((row) => (row.excludeFromInvoiceTab ?? row.exclude_from_invoice_tab) === false)
    .filter((row) => (row.taxLineId ?? row.tax_line_id) == null)
    .filter((row) => !String(row.displayType ?? row.display_type ?? '').trim())
    .slice()
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .map((row) => ({
      id: String(row.id),
      description: String(row.name ?? ''),
      quantity: invoiceRecordAmount(row.quantity),
      unitPrice: invoiceRecordAmount(row.priceUnit ?? row.price_unit),
      discount: invoiceRecordAmount(row.discount),
      amount: invoiceRecordAmount(row.priceSubtotal ?? row.price_subtotal),
    }));
}

/** Match catalog IDs exactly; currency IDs have no universal USD/EUR interpretation. */
export function invoiceRecordCurrency(move: CurrencyProjection, currencies: readonly CurrencyCatalogProjection[]) {
  const id = String(move.currencyId ?? move.currency_id ?? '');
  const matches = currencies.filter((currency) => String(currency.id) === id);
  const code = matches.length === 1 ? String(matches[0]?.code ?? '').trim().toUpperCase() : '';
  return { id: id || undefined, code: /^[A-Z]{3}$/.test(code) ? code : undefined };
}
