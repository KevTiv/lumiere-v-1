import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@lumiere/query-hooks/http';
import { stdbBffCommandPost } from '@lumiere/stdb/commands';
import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';
import type { QueueMailFromTemplateParams } from '@lumiere/stdb/types';
import { createStdbSdk } from '@lumiere/stdb/sdk';
import {
  invoiceEmailContext, invoiceEmailRecordRevision, invoiceEmailRecipientProblem, invoiceEmailTemplateProblem, invoiceEmailTemplates,
  parseInvoiceEmailMessages, parseInvoiceEmailTemplates, resolveInvoiceEmailQueue, sameInvoiceEmailTemplate,
  type InvoiceEmailDocument, type InvoiceEmailQueueOutcome, type InvoiceEmailSubmission,
} from '../../../../../../packages/ui/src/accounting-components/invoice-email-review';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export class InvoiceEmailReadError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'InvoiceEmailReadError'; }
}

async function responseError(response: Response): Promise<InvoiceEmailReadError> {
  const payload: unknown = await response.json().catch(() => null);
  return new InvoiceEmailReadError(payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
    ? payload.error : `Email review request failed (${response.status}).`, response.status);
}

export async function fetchInvoiceEmailTemplates(fetcher: Fetcher = apiFetch) {
  const response = await fetcher('/api/query/mail-templates');
  if (!response.ok) throw await responseError(response);
  return parseInvoiceEmailTemplates(await response.json());
}

export function useInvoiceEmailTemplates(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['invoice-email-review-templates', String(organizationId)],
    queryFn: () => fetchInvoiceEmailTemplates(), enabled: enabled && organizationId > 0, retry: false, staleTime: 30_000,
  });
}

export function invoiceEmailQueueRequest(submission: InvoiceEmailSubmission) {
  const params: QueueMailFromTemplateParams = {
    templateId: submission.template.id, model: 'account_move', resId: submission.document.moveId,
    recipientEmail: submission.recipient.trim(), contextJson: invoiceEmailContext(submission),
  };
  return stdbBffCommandPost('queue_mail_from_template', {
    companyId: submission.document.companyId, params: stdbParamsToJson(params, 'QueueMailFromTemplateParams'),
  });
}

/** One page-scoped client retains dispatched review tokens, preventing an automatic queue replay. */
export function createInvoiceEmailQueueClient(fetcher: Fetcher = apiFetch) {
  const sdk = createStdbSdk(async (input, init) => {
    if (typeof input !== 'string') throw new Error('The invoice review query must use a canonical resource path.');
    return fetcher(input, init);
  });
  const dispatched = new Set<string>();
  const unknown = (submission: InvoiceEmailSubmission, message: string): InvoiceEmailQueueOutcome => ({ status: 'unknown', submission, message });
  const readMessages = async (submission: InvoiceEmailSubmission) => {
    const response = await fetcher('/api/query/mail-messages');
    if (!response.ok) throw await responseError(response);
    return parseInvoiceEmailMessages(await response.json(), submission.document);
  };
  const check = async (submission: InvoiceEmailSubmission, mayRead = () => true): Promise<InvoiceEmailQueueOutcome> => {
    if (!mayRead()) return unknown(submission, 'Return to the original company and invoice to check this request. No new email was queued.');
    try {
      const confirmed = resolveInvoiceEmailQueue(await readMessages(submission), submission);
      if (!mayRead()) return unknown(submission, 'The active scope changed while checking the original request. No new email was queued.');
      return confirmed === undefined ? unknown(submission, 'The exact queued message is not confirmed. It may have queued or been processed; do not queue it again. Check the original request or ask an administrator to inspect the outbox.')
        : { ...confirmed, submission };
    } catch (error) {
      return unknown(submission, `${error instanceof Error ? error.message : 'Queue readback is unavailable.'} The original request remains unconfirmed; no new copy was queued.`);
    }
  };

  const queue = async (submission: InvoiceEmailSubmission, mayDispatch = () => true): Promise<InvoiceEmailQueueOutcome> => {
    if (dispatched.has(submission.reviewId)) return check(submission, mayDispatch);
    const problem = invoiceEmailRecipientProblem(submission.recipient) || invoiceEmailTemplateProblem(submission.template);
    if (problem || !submission.document.posted) return { status: 'rejected', message: problem || 'Post the customer invoice before queueing its email.' };
    if (new TextEncoder().encode(submission.document.revision).length > 65_536 || new TextEncoder().encode(invoiceEmailContext(submission)).length > 131_072) {
      return { status: 'rejected', message: 'This document or email exceeds the supported review size. No email was queued.' };
    }
    try {
      const [templates, messages, moves] = await Promise.all([
        fetchInvoiceEmailTemplates(fetcher), readMessages(submission), sdk.forCompany(submission.document.companyId).accounting.moves.list(),
      ]);
      const existing = resolveInvoiceEmailQueue(messages, submission);
      if (existing !== undefined) return { ...existing, submission };
      const current = invoiceEmailTemplates(templates, submission.document).find((row) => row.id === submission.template.id);
      if (!current || !sameInvoiceEmailTemplate(current, submission.template)) return { status: 'rejected', message: 'The selected template changed or is no longer available. Reload templates and review the latest literal message. No email was queued.' };
      const records = moves.filter((row) => row.id === submission.document.moveId && row.organizationId === submission.document.organizationId && row.companyId === submission.document.companyId);
      if (records.length !== 1 || invoiceEmailRecordRevision(records[0]!) !== submission.document.revision) return { status: 'rejected', message: 'The invoice changed or is no longer readable in its original company. Review the current document before queueing. No email was queued.' };
      if (!mayDispatch()) return { status: 'rejected', message: 'The active company, invoice or access changed before queueing. No email was queued.' };
    } catch (error) {
      return { status: 'rejected', message: `${error instanceof Error ? error.message : 'The review could not be refreshed.'} No email was queued.` };
    }
    // Independent callers can finish preflight together. Claim the review token before the first POST.
    if (dispatched.has(submission.reviewId)) return check(submission, mayDispatch);
    let command: ReturnType<typeof invoiceEmailQueueRequest>;
    try { command = invoiceEmailQueueRequest(submission); }
    catch { return { status: 'rejected', message: 'The current command transport cannot represent this request exactly. No email was queued.' }; }
    dispatched.add(submission.reviewId);
    try {
      const response = await fetcher(command.urlPath, { ...command.init, signal: AbortSignal.timeout(30_000) });
      if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408) {
        const error = await responseError(response);
        return { status: 'rejected', message: `${error.message} No queue confirmation was returned.` };
      }
    } catch {
      // A response can be lost after the reducer creates the message. Reconcile only; never replay.
    }
    return check(submission, mayDispatch);
  };
  return { queue, check };
}

export async function downloadInvoiceReviewPdf(document: InvoiceEmailDocument, fetcher: Fetcher = apiFetch): Promise<void> {
  const response = await fetcher(`/api/documents/pdf/account-move/${document.moveId}`);
  if (!response.ok) throw await responseError(response);
  if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('The invoice PDF could not be confirmed.');
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = window.document.createElement('a');
    anchor.href = objectUrl; anchor.download = document.pdfFilename; anchor.click();
  } finally { URL.revokeObjectURL(objectUrl); }
}
