
import { i18n } from "@lumiere/i18n"
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@lumiere/query-hooks/http';
import { stdbBffCommandPost } from '@lumiere/stdb/commands';
import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';
import type { QueueMailFromTemplateParams } from '@lumiere/stdb/types';
import { createStdbSdk } from '@lumiere/stdb/sdk';
import {
  invoiceEmailContent, invoiceEmailContentProblem, invoiceEmailContext, invoiceEmailRecordRevision, invoiceEmailRecipientProblem, invoiceEmailTemplateProblem, invoiceEmailTemplates,
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
    if (typeof input !== 'string') throw new Error(i18n.t("accounting.invoiceEmailTransport.theInvoiceReviewQueryMustUseACanonicalResourcePath"));
    return fetcher(input, init);
  });
  const dispatched = new Set<string>();
  const dispatchAttempts = new Set<string>();
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
      if (confirmed?.status === 'queued' && dispatchAttempts.has(submission.reviewId)) return unknown(submission, 'This dispatch was already attempted. Its acceptance is not confirmed; inspect the original request without sending another copy.');
      return confirmed === undefined ? unknown(submission, 'The exact queued message is not confirmed. It may have queued or been processed; do not queue it again. Check the original request or ask an administrator to inspect the outbox.')
        : { ...confirmed, submission };
    } catch (error) {
      return unknown(submission, `${error instanceof Error ? error.message : i18n.t("accounting.invoiceEmailTransport.queueReadbackIsUnavailable")} The original request remains unconfirmed; no new copy was queued.`);
    }
  };

  const queue = async (submission: InvoiceEmailSubmission, mayDispatch = () => true): Promise<InvoiceEmailQueueOutcome> => {
    if (dispatched.has(submission.reviewId)) return check(submission, mayDispatch);
    const reviewedContent = invoiceEmailContent(submission);
    const problem = invoiceEmailRecipientProblem(submission.recipient) || invoiceEmailTemplateProblem({ ...submission.template, subject: reviewedContent.subject, bodyHtml: reviewedContent.bodyText }) || invoiceEmailContentProblem(reviewedContent) || (!submission.content && submission.template.attachDocument ? i18n.t("accounting.invoiceEmailTransport.reviewThisInvoiceAgainToApproveItsPDFAttachment") : null);
    if (problem || !submission.document.posted) return { status: 'rejected', message: problem || i18n.t("accounting.invoiceEmailTransport.postTheCustomerInvoiceBeforeQueueingItsEmail") };
    if (new TextEncoder().encode(submission.document.revision).length > 65_536 || new TextEncoder().encode(invoiceEmailContext(submission)).length > 131_072) {
      return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.thisDocumentOrEmailExceedsTheSupportedReviewSizeNoEmail") };
    }
    try {
      const [templates, messages, moves] = await Promise.all([
        fetchInvoiceEmailTemplates(fetcher), readMessages(submission), sdk.forCompany(submission.document.companyId).accounting.moves.list(),
      ]);
      const existing = resolveInvoiceEmailQueue(messages, submission);
      if (existing !== undefined) return { ...existing, submission };
      const current = invoiceEmailTemplates(templates, submission.document).find((row) => row.id === submission.template.id);
      if (!current || !sameInvoiceEmailTemplate(current, submission.template)) return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.theSelectedTemplateChangedOrIsNoLongerAvailableReloadTemplates") };
      const records = moves.filter((row) => row.id === submission.document.moveId && row.organizationId === submission.document.organizationId && row.companyId === submission.document.companyId);
      if (records.length !== 1 || invoiceEmailRecordRevision(records[0]!) !== submission.document.revision) return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.theInvoiceChangedOrIsNoLongerReadableInItsOriginal") };
      if (!mayDispatch()) return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.theActiveCompanyInvoiceOrAccessChangedBeforeQueueingNoEmail") };
    } catch (error) {
      return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.reviewFailureNoQueue", { message: error instanceof Error ? error.message : i18n.t("accounting.invoiceEmailTransport.theReviewCouldNotBeRefreshed") }) };
    }
    // Independent callers can finish preflight together. Claim the review token before the first POST.
    if (dispatched.has(submission.reviewId)) return check(submission, mayDispatch);
    let command: ReturnType<typeof invoiceEmailQueueRequest>;
    try { command = invoiceEmailQueueRequest(submission); }
    catch { return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.theCurrentCommandTransportCannotRepresentThisRequestExactlyNoEmail") }; }
    dispatched.add(submission.reviewId);
    try {
      const response = await fetcher(command.urlPath, { ...command.init, signal: AbortSignal.timeout(30_000) });
      if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408) {
        const error = await responseError(response);
        return { status: 'rejected', message: i18n.t("accounting.invoiceEmailTransport.noQueueConfirmation", { message: error.message }) };
      }
    } catch {
      // A response can be lost after the reducer creates the message. Reconcile only; never replay.
    }
    return check(submission, mayDispatch);
  };
  const dispatch = async (submission: InvoiceEmailSubmission, messageId: bigint, mayDispatch = () => true): Promise<InvoiceEmailQueueOutcome> => {
    if (!mayDispatch()) return unknown(submission, 'Return to the original readable invoice and company before dispatching this reviewed request.');
    if (dispatchAttempts.has(submission.reviewId)) {
      const result = await check(submission, mayDispatch);
      return result.status === 'queued' ? unknown(submission, 'This dispatch was already attempted. Inspect the original request without sending another copy.') : result;
    }
    try {
      const current = resolveInvoiceEmailQueue(await readMessages(submission), submission);
      if (!current || current.messageId !== messageId) return unknown(submission, 'The exact queued message could not be confirmed. No dispatch was attempted.');
      // A resumed outbox review has already consumed its queue token too.
      dispatched.add(submission.reviewId);
      if (current.status !== 'queued') return { ...current, submission };
      if (!mayDispatch()) return unknown(submission, 'The active invoice, company or access changed. No dispatch was attempted.');
    } catch { return unknown(submission, 'The original queue request is unreadable. No dispatch was attempted.'); }
    // A second caller may finish the same read concurrently; claim locally before POST.
    if (dispatchAttempts.has(submission.reviewId)) return unknown(submission, 'This dispatch is already being checked. No second request was sent.');
    dispatchAttempts.add(submission.reviewId);
    try {
      await fetcher(`/api/mail/messages/${messageId}/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: submission.reviewId }), signal: AbortSignal.timeout(120_000) });
    } catch { /* A durable claim or provider acceptance may have succeeded: reconcile without retry. */ }
    const result = await check(submission, mayDispatch);
    return result.status === 'queued' ? unknown(submission, 'Dispatch was not confirmed. Inspect this original request; do not send another copy.') : result;
  };
  return { queue, check, dispatch };
}

export async function downloadInvoiceReviewPdf(document: InvoiceEmailDocument, fetcher: Fetcher = apiFetch): Promise<void> {
  const response = await fetcher(`/api/documents/pdf/account-move/${document.moveId}`);
  if (!response.ok) throw await responseError(response);
  if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error(i18n.t("accounting.invoiceEmailTransport.theInvoicePDFCouldNotBeConfirmed"));
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = window.document.createElement('a');
    anchor.href = objectUrl; anchor.download = document.pdfFilename; anchor.click();
  } finally { URL.revokeObjectURL(objectUrl); }
}
