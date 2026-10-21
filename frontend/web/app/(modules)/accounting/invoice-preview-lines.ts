import type { AccountMoveLineQueryRow } from '@lumiere/stdb/resource-reads';
import type { InvoicePreviewLine } from '@lumiere/ui';

/** Commercial lines only: not the tax, receivable/payable or rounding lines the ledger adds. */
function isCommercialLine(line: AccountMoveLineQueryRow): boolean {
  const type = (line.displayType ?? '').toLowerCase();
  if (type) return type === 'product';
  return line.taxLineId == null && Number(line.quantity ?? 0) > 0 && Number(line.priceUnit ?? 0) !== 0;
}

/** The lines of one move as invoice-sheet rows, in ledger order. */
export function invoicePreviewLines(
  moveLines: readonly AccountMoveLineQueryRow[],
  moveId: string,
): InvoicePreviewLine[] {
  return moveLines
    .filter((line) => String(line.moveId) === moveId && isCommercialLine(line))
    .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
    .map((line) => ({
      key: String(line.id),
      description: line.name ?? '',
      quantity: Number(line.quantity ?? 0),
      unitPrice: Number(line.priceUnit ?? 0),
      discount: Number(line.discount ?? 0),
      total: Number(line.priceSubtotal ?? Number(line.quantity ?? 0) * Number(line.priceUnit ?? 0)),
    }));
}
