import { describe, expect, it } from 'vitest';
import {
  defaultInvoiceEmailTemplate, invoiceEmailContext, invoiceEmailTemplateProblem, invoiceEmailTemplates,
  parseInvoiceEmailMessages, parseInvoiceEmailTemplates, resolveInvoiceEmailQueue,
  type InvoiceEmailDocument, type InvoiceEmailMessage, type InvoiceEmailSubmission, type InvoiceEmailTemplate,
} from './invoice-email-review';

const document: InvoiceEmailDocument = { organizationId: 1n, companyId: 3n, moveId: 42n, reference: 'INV/42', partner: 'Alpha', companyName: 'Our company', totalLabel: 'EUR 120.00', pdfFilename: 'account-move-42.pdf', posted: true, revision: 'v1' };
const template: InvoiceEmailTemplate = { id: 9n, organizationId: 1n, companyId: undefined, name: 'Invoice note', model: 'account_move', subject: 'Invoice ready', bodyHtml: 'Your invoice is ready.', attachDocument: false, isActive: true, isDefault: true };
const submission: InvoiceEmailSubmission = { reviewId: 'unique-review', document, template, recipient: 'alpha@example.test' };
const message = (delivery = 'queued'): InvoiceEmailMessage => ({ id: 10n, organizationId: 1n, model: 'account_move', resId: 42n, body: template.bodyHtml, metadata: JSON.stringify({ delivery, context_json: invoiceEmailContext(submission), mail_template_id: 9, to: submission.recipient, subject: template.subject, html: template.bodyHtml }) });

describe('invoice email review projections', () => {
  it('selects only active exact-company or organization account-move templates, with deliberate defaults', () => {
    const company = { ...template, id: 11n, companyId: 3n };
    const rows = [template, company, { ...template, id: 12n, companyId: 4n }, { ...template, id: 13n, organizationId: 2n }, { ...template, id: 14n, isActive: false }, { ...template, id: 15n, model: 'sale_order' }];
    expect(invoiceEmailTemplates(rows, document).map((row) => row.id)).toEqual([11n, 9n]);
    expect(defaultInvoiceEmailTemplate(rows, document)).toBe(11n);
    expect(defaultInvoiceEmailTemplate([...rows, { ...company, id: 16n }], document)).toBeUndefined();
  });

  it('does not infer organization scope, active state, or attachment capability from redaction', () => {
    const raw = { id: '9', organization_id: '1', company_id: null, name: 'Invoice', model: 'account_move', subject: 'Invoice', body_html: 'Literal body', attach_document: false, is_default: true, is_active: true };
    expect(parseInvoiceEmailTemplates({ data: [raw] })[0]?.companyId).toBeUndefined();
    const { company_id: _company, ...redacted } = raw;
    expect(() => parseInvoiceEmailTemplates({ data: [redacted] })).toThrow(/companyId/);
    expect(() => parseInvoiceEmailTemplates({ data: [{ ...raw, is_active: null }] })).toThrow(/active/);
  });

  it('blocks unsupported attachment and placeholder templates instead of promising absent capabilities', () => {
    expect(invoiceEmailTemplateProblem({ ...template, attachDocument: true })).toMatch(/attachments are not supported/);
    expect(invoiceEmailTemplateProblem({ ...template, subject: 'Invoice {{object.name}}' })).toMatch(/not expanded/);
    expect(invoiceEmailTemplateProblem({ ...template, bodyHtml: '${invoice.reference}' })).toMatch(/not expanded/);
    expect(invoiceEmailTemplateProblem(template)).toBeNull();
  });

  it('correlates exact recipient/template/content/document token and distinguishes dispatch from delivery', () => {
    expect(resolveInvoiceEmailQueue([message()], submission)).toEqual({ messageId: 10n, status: 'queued' });
    expect(resolveInvoiceEmailQueue([message('sent')], submission)).toEqual({ messageId: 10n, status: 'dispatched' });
    expect(resolveInvoiceEmailQueue([{ ...message(), resId: 43n }], submission)).toBeUndefined();
    expect(resolveInvoiceEmailQueue([{ ...message(), organizationId: 2n }], submission)).toBeUndefined();
    expect(resolveInvoiceEmailQueue([message()], { ...submission, recipient: 'another@example.test' })).toBeUndefined();
    expect(() => resolveInvoiceEmailQueue([message(), { ...message(), id: 11n }], submission)).toThrow(/More than one/);
  });

  it('ignores unrelated res_id=0 chatter while failing on unreadable fields of the exact invoice', () => {
    const own = { ...message(), id: '10', organizationId: '1', resId: '42' };
    expect(parseInvoiceEmailMessages({ data: [{ model: 'note', res_id: 0 }, own] }, document)).toHaveLength(1);
    const { metadata: _metadata, ...redacted } = own;
    expect(() => parseInvoiceEmailMessages({ data: [redacted] }, document)).toThrow(/metadata/);
  });

  it('keeps canonical u64 IDs as bigint and rejects already-rounded JSON numbers', () => {
    const raw = { id: '9007199254740993', organizationId: '1', companyId: null, name: 'Invoice', model: 'account_move', subject: 'Invoice', bodyHtml: 'Body', attachDocument: false, isDefault: true, isActive: true };
    expect(parseInvoiceEmailTemplates({ data: [raw] })[0]?.id).toBe(9007199254740993n);
    expect(() => parseInvoiceEmailTemplates({ data: [{ ...raw, id: 9007199254740992 }] })).toThrow(/unsafe ID/);
  });

  it('binds the atomic reducer guard to the exact reviewed subject/body/record without claiming an attachment', () => {
    const context = JSON.parse(invoiceEmailContext(submission)) as { invoiceReview: { expectedSubject: string; expectedBodyHtml: string; expectedAttachDocument: boolean; recordRevision: string; pdfAttached: boolean } };
    expect(context.invoiceReview.expectedSubject).toBe(template.subject);
    expect(context.invoiceReview.expectedBodyHtml).toBe(template.bodyHtml);
    expect(context.invoiceReview.expectedAttachDocument).toBe(false);
    expect(context.invoiceReview.pdfAttached).toBe(false);
    expect(context.invoiceReview.recordRevision).toBe(document.revision);
  });
});
