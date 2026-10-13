import { invoiceKind } from './invoice-status';

/** Where an invoice, bill or credit note has a page of its own. Plain journal entries have none. */
export function invoiceRecordHref(move: Record<string, unknown>): string | undefined {
  if (move.id == null || invoiceKind(move) === 'entry') return undefined;
  return `/accounting/invoices/${String(move.id)}`;
}
