import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvoiceEmailReviewDialog, type InvoiceEmailReviewDialogProps } from './invoice-email-review-dialog';
import { invoiceEmailDocumentKey, invoiceEmailScope, type InvoiceEmailQueueOutcome, type InvoiceEmailSubmission } from './invoice-email-review';

vi.mock('../forms/use-unsaved-changes-guard', () => ({ useUnsavedChangesGuard: () => null }));
beforeAll(() => { vi.stubGlobal('PointerEvent', MouseEvent); });
afterEach(cleanup);

function props(overrides: Partial<InvoiceEmailReviewDialogProps> = {}): InvoiceEmailReviewDialogProps {
  const document = { organizationId: 1n, companyId: 3n, moveId: 42n, reference: 'INV/42', partner: 'Alpha', companyName: 'Our company', totalLabel: 'EUR 120.00', pdfFilename: 'account-move-42.pdf', posted: true, revision: 'v1' };
  return {
    open: true, document, currentScopeKey: invoiceEmailScope(document), currentDocumentKey: invoiceEmailDocumentKey(document),
    templates: [{ id: 9n, organizationId: 1n, companyId: undefined, name: 'Invoice message', model: 'account_move', subject: 'Invoice ready', bodyHtml: '<p>Literal & complete message</p>', attachDocument: false, isDefault: true, isActive: true }],
    templateState: { status: 'ready' }, canQueue: true, canCheck: true,
    onQueue: vi.fn(async (submission) => ({ status: 'queued' as const, submission, messageId: 10n })),
    onCheck: vi.fn(async (submission) => ({ status: 'unknown' as const, submission, message: 'Still unknown. No new copy was queued.' })),
    onReviewPdf: vi.fn(async () => undefined), onReloadTemplates: vi.fn(), onClose: vi.fn(), ...overrides,
  };
}

function review() {
  fireEvent.change(screen.getByTestId('invoice-email-recipient'), { target: { value: 'alpha@example.test' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this recipient/ }));
}

describe('invoice email review', () => {
  it('requires reviewed recipient/content and renders literal HTML inertly with truthful attachment limits', async () => {
    const input = props(); render(<InvoiceEmailReviewDialog {...input} />);
    expect((screen.getByTestId('invoice-email-queue') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('invoice-email-body').textContent).toBe('<p>Literal & complete message</p>');
    expect(screen.getByTestId('invoice-email-body').querySelector('p')).toBeNull();
    expect(screen.getByText(/The PDF is not attached/)).toBeTruthy();
    review(); fireEvent.click(screen.getByTestId('invoice-email-queue'));
    await screen.findByText('Email queue confirmed');
    expect(input.onQueue).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Sending and delivery are not confirmed/)).toBeTruthy();
  });

  it('invalidates the confirmation when recipient or literal content changes', () => {
    const input = props(); const { rerender } = render(<InvoiceEmailReviewDialog {...input} />); review();
    fireEvent.change(screen.getByTestId('invoice-email-recipient'), { target: { value: 'beta@example.test' } });
    expect((screen.getByTestId('invoice-email-queue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    rerender(<InvoiceEmailReviewDialog {...input} templates={[{ ...input.templates[0]!, bodyHtml: 'Updated body' }]} />);
    expect((screen.getByTestId('invoice-email-queue') as HTMLButtonElement).disabled).toBe(true);
  });

  it('retains an unknown original request across close/reopen and never offers another queue', async () => {
    const input = props({ onQueue: vi.fn(async (submission) => ({ status: 'unknown', submission, message: 'Queue response lost. Check the original request.' })) });
    const { rerender } = render(<InvoiceEmailReviewDialog {...input} />); review(); fireEvent.click(screen.getByTestId('invoice-email-queue'));
    await screen.findByText('Queue status unknown');
    rerender(<InvoiceEmailReviewDialog {...input} open={false} />);
    rerender(<InvoiceEmailReviewDialog {...input} />);
    expect(await screen.findByText('Queue status unknown')).toBeTruthy();
    expect(screen.queryByTestId('invoice-email-queue')).toBeNull();
    fireEvent.click(screen.getByTestId('invoice-email-check'));
    await waitFor(() => expect(input.onCheck).toHaveBeenCalledTimes(1));
    expect(input.onQueue).toHaveBeenCalledTimes(1);
  });

  it('fences a pending request on company/document retargeting and preserves original identity', async () => {
    let finish!: (value: InvoiceEmailQueueOutcome) => void;
    let original!: InvoiceEmailSubmission;
    const input = props({ onQueue: vi.fn((submission) => { original = submission; return new Promise<InvoiceEmailQueueOutcome>((resolve) => { finish = resolve; }); }) });
    const { rerender } = render(<InvoiceEmailReviewDialog {...input} />); review();
    fireEvent.click(screen.getByTestId('invoice-email-queue')); fireEvent.click(screen.getByTestId('invoice-email-queue'));
    const other = { ...input.document, companyId: 4n, reference: 'OTHER/42' };
    rerender(<InvoiceEmailReviewDialog {...input} document={other} currentScopeKey={invoiceEmailScope(other)} currentDocumentKey={invoiceEmailDocumentKey(other)} />);
    expect(vi.mocked(input.onQueue).mock.calls[0]?.[1]()).toBe(false);
    expect(input.onQueue).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ status: 'unknown', submission: original, message: 'Original request unknown.' }); });
    expect(screen.getByText(/INV\/42 · Review/)).toBeTruthy();
    expect((screen.getByTestId('invoice-email-check') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('invoice-email-queue')).toBeNull();
  });

  it('permits read-only original recovery after template/write access fails, without exposing stale body', async () => {
    const input = props({ onQueue: vi.fn(async (submission) => ({ status: 'unknown', submission, message: 'Original request unknown.' })) });
    const { rerender } = render(<InvoiceEmailReviewDialog {...input} />); review(); fireEvent.click(screen.getByTestId('invoice-email-queue'));
    await screen.findByText('Queue status unknown');
    rerender(<InvoiceEmailReviewDialog {...input} canQueue={false} canCheck templateState={{ status: 'denied' }} />);
    expect(screen.queryByTestId('invoice-email-body')).toBeNull();
    expect((screen.getByTestId('invoice-email-check') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('invoice-email-check'));
    await waitFor(() => expect(input.onCheck).toHaveBeenCalledTimes(1));
  });

  it('does not claim recipient delivery when an exact dispatcher record is found', async () => {
    const input = props({ onQueue: vi.fn(async (submission) => ({ status: 'dispatched', submission, messageId: 10n })) });
    render(<InvoiceEmailReviewDialog {...input} />); review(); fireEvent.click(screen.getByTestId('invoice-email-queue'));
    await screen.findByText('Email dispatch recorded');
    expect(screen.getByText(/Recipient delivery is not confirmed/)).toBeTruthy();
    expect(screen.queryByTestId('invoice-email-queue')).toBeNull();
  });
});
