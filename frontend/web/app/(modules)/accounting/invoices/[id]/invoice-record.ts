type Row = Record<string, unknown>;

/** Unknown/redacted amounts are different from a known zero. */
export function invoiceRecordAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** Record links may outlive a company switch; never resolve a document from another company. */
export function resolveInvoiceRecord(rows: readonly Row[], moveId: string, companyId: bigint): Row | undefined {
  const matches = rows.filter((row) => String(row.id) === moveId && sameCompany(row, companyId));
  return matches.length === 1 ? matches[0] : undefined;
}

export function sameCompany(row: Row, companyId: bigint): boolean {
  return String(row.companyId ?? row.company_id ?? '') === String(companyId);
}

export function invoiceRecordLines(rows: readonly Row[], moveId: string, companyId: bigint): Row[] {
  return rows.filter((row) => String(row.moveId ?? row.move_id ?? '') === moveId && sameCompany(row, companyId));
}

/** Invoice paper contains commercial lines, not their receivable/payable or tax ledger entries. */
export function invoiceDocumentLines(lines: readonly Row[]) {
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
export function invoiceRecordCurrency(move: Row, currencies: readonly Row[]) {
  const id = String(move.currencyId ?? move.currency_id ?? '');
  const matches = currencies.filter((currency) => String(currency.id) === id);
  const code = matches.length === 1 ? String(matches[0]?.code ?? '').trim().toUpperCase() : '';
  return { id: id || undefined, code: /^[A-Z]{3}$/.test(code) ? code : undefined };
}
