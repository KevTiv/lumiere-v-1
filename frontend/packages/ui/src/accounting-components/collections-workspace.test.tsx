import { chooseSelectValue } from "../components/select-test-utils"
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountMove } from '../lib/accounting-types';
import { collectionInvoices, CollectionsWorkspace } from './collections-workspace';

afterEach(cleanup);
const scope = { organizationId: 1n, companyId: 2n };
const now = new Date('2026-10-18T20:00:00Z');
const timestamp = (date: string) => ({ microsSinceUnixEpoch: BigInt(new Date(date).getTime()) * 1000n });
const invoice = (id: number, due: string, overrides: Partial<AccountMove> = {}): AccountMove => ({
  id, ...scope, name: `INV/${id}`, invoicePartnerDisplayName: 'Alpha', state: 'Posted', moveType: 'OutInvoice',
  amountTotal: 100, amountResidual: 40, currencyId: 7, invoiceDateDue: timestamp(due), ...overrides,
});

describe('collections', () => {
  it('uses UTC calendar ageing, excludes credits/drafts/paid/foreign/redacted records and keeps partial residuals', () => {
    const rows = [invoice(1, '2026-10-17T23:00:00Z'), invoice(2, '2026-10-18T00:00:00Z'),
      invoice(3, '2026-07-18T00:00:00Z'), invoice(4, '2026-10-01', { moveType: 'OutRefund' }),
      invoice(5, '2026-10-01', { state: 'Draft' }), invoice(6, '2026-10-01', { amountResidual: 0 }),
      invoice(7, '2026-10-01', { companyId: 3 }), invoice(8, '2026-10-01', { organizationId: undefined }),
      invoice(9, '2026-10-01', { amountResidual: Number.NaN })];
    expect(collectionInvoices(rows, scope, now).map((row) => [row.invoice.id, row.daysOverdue, row.age])).toEqual([[3, 92, '90+'], [1, 1, '1-30']]);
  });

  it('separates currency totals, filters age and hands only the selected invoice into review', () => {
    const onReviewReminder = vi.fn();
    const rows = [invoice(1, '2026-10-17'), invoice(2, '2026-08-01', { currencyId: 8, amountResidual: 25 })];
    render(<CollectionsWorkspace invoices={rows} scope={scope} now={now} currencyOptions={[{ value: '7', code: 'USD' }, { value: '8', code: 'EUR' }]} dataState={{ status: 'ready' }} canReview onReviewReminder={onReviewReminder} />);
    expect(screen.getByLabelText('Overdue balance by currency').textContent).toContain('USD');
    expect(screen.getByLabelText('Overdue balance by currency').textContent).toContain('EUR');
    chooseSelectValue(screen.getByLabelText("Days overdue"), "61-90");
    expect(screen.queryByText('INV/1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Review reminder for INV\/2/ }));
    expect(onReviewReminder).toHaveBeenCalledWith(rows[1]);
  });

  it('hides failed or denied cached invoice data and disables review without mutation authority', () => {
    const input = { invoices: [invoice(1, '2026-10-17')], scope, now, canReview: false, onReviewReminder: vi.fn() };
    const { rerender } = render(<CollectionsWorkspace {...input} dataState={{ status: 'ready' }} />);
    expect((screen.getByRole('button', { name: /Review reminder/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<CollectionsWorkspace {...input} dataState={{ status: 'denied' }} />);
    expect(screen.queryByText('INV/1')).toBeNull();
    rerender(<CollectionsWorkspace {...input} dataState={{ status: 'partial' }} />);
    expect(screen.queryByText('INV/1')).toBeNull();
  });
});
