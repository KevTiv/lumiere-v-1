'use client';

import { useRef, useState } from 'react';
import { Check, Download, Mail, RefreshCw, X } from 'lucide-react';
import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/dialog';
import { Input } from '../components/input';
import { Label } from '../components/label';
import { Textarea } from '../components/textarea';
import { useUnsavedChangesGuard } from '../forms/use-unsaved-changes-guard';
import type { ModuleDataState } from '../lib/module-data-state';
import { ModuleDataNotice } from '../pages/module-data-notice';
import {
  defaultInvoiceEmailTemplate, invoiceEmailDocumentKey, invoiceEmailRecipientProblem, invoiceEmailScope,
  invoiceEmailContent, invoiceEmailContentProblem, invoiceEmailTemplateProblem, invoiceEmailTemplates,
  type InvoiceEmailDocument, type InvoiceEmailQueueOutcome, type InvoiceEmailSubmission, type InvoiceEmailTemplate,
} from './invoice-email-review';

export interface InvoiceEmailReviewDialogProps {
  open: boolean;
  purpose?: 'invoice' | 'reminder';
  document: InvoiceEmailDocument;
  currentScopeKey: string;
  currentDocumentKey: string | null;
  templates: readonly InvoiceEmailTemplate[];
  templateState: ModuleDataState;
  canQueue: boolean;
  canCheck: boolean;
  onQueue: (submission: InvoiceEmailSubmission, mayDispatch: () => boolean) => Promise<InvoiceEmailQueueOutcome>;
  onDispatch?: (submission: InvoiceEmailSubmission, messageId: bigint, mayDispatch: () => boolean) => Promise<InvoiceEmailQueueOutcome>;
  onCheck: (submission: InvoiceEmailSubmission) => Promise<InvoiceEmailQueueOutcome>;
  onReviewPdf: (document: InvoiceEmailDocument) => Promise<void>;
  onReloadTemplates: () => void;
  onRefreshDocument?: () => void;
  onClose: () => void;
}

/** Review one plain text message, queue it once, then explicitly dispatch that exact queued request. */
export function InvoiceEmailReviewDialog(props: InvoiceEmailReviewDialogProps) {
  const { open, templateState } = props;
  // The parent may change route/company props while a request is in flight.
  // A review instance always remains bound to its original immutable document context.
  const [document] = useState<InvoiceEmailDocument>(() => ({ ...props.document }));
  const [recipient, setRecipient] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [edited, setEdited] = useState<{ templateKey: string; subject: string; bodyText: string; attachPdf: boolean } | null>(null);
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvoiceEmailQueueOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const liveAllowed = useRef(false);
  const sourceChanged = props.currentScopeKey !== invoiceEmailScope(document) || props.currentDocumentKey !== invoiceEmailDocumentKey(document);
  const sourceReady = templateState.status === 'ready' && !sourceChanged && props.canQueue && document.posted;
  const canCheckOriginal = props.canCheck && props.currentScopeKey === invoiceEmailScope(document);
  liveAllowed.current = sourceReady;
  const submitted = outcome?.status === 'queued' || outcome?.status === 'dispatching' || outcome?.status === 'dispatched' || outcome?.status === 'unknown' ? outcome.submission : null;
  const locked = pending || checking || submitted !== null;
  const templates = invoiceEmailTemplates(props.templates, document);
  const selectedId = templateId || String(defaultInvoiceEmailTemplate(templates, document) ?? '');
  const template = templates.find((row) => String(row.id) === selectedId);
  const recipientProblem = recipient.trim() ? invoiceEmailRecipientProblem(recipient) : null;
  const templateKey = template ? JSON.stringify([String(template.id), template.subject, template.bodyHtml, template.attachDocument]) : '';
  const content = edited?.templateKey === templateKey ? edited : {
    templateKey, subject: props.purpose === 'reminder' ? `Payment reminder: ${document.reference}` : template?.subject ?? '',
    bodyText: props.purpose === 'reminder' ? `Hello ${document.partner},\n\nThis is a reminder that payment for invoice ${document.reference} is overdue. Please let us know when we can expect payment. If you have already paid, please share the payment reference so we can reconcile it.\n\nThank you,\n${document.companyName}` : template?.bodyHtml ?? '',
    attachPdf: template?.attachDocument ?? false,
  };
  const templateProblem = template ? invoiceEmailTemplateProblem({ ...template, subject: content.subject, bodyHtml: content.bodyText }) : null;
  const contentProblem = invoiceEmailContentProblem(content);
  const edit = (next: Partial<Pick<typeof content, 'subject' | 'bodyText' | 'attachPdf'>>) => setEdited({ ...content, ...next });
  const contentKey = template ? JSON.stringify([invoiceEmailDocumentKey(document), String(template.id), template.subject, template.bodyHtml, template.attachDocument, recipient.trim(), content.subject, content.bodyText, content.attachPdf]) : null;
  const reviewed = contentKey !== null && reviewedKey === contentKey;
  const canSubmit = sourceReady && !locked && !pdfPending && template !== undefined && !templateProblem && !contentProblem && recipient.trim() !== '' && !recipientProblem && reviewed;
  const navigationDialog = useUnsavedChangesGuard(recipient.trim() !== '' && outcome?.status !== 'queued' && outcome?.status !== 'dispatched' || outcome?.status === 'unknown' || outcome?.status === 'dispatching', pending || checking);

  const queue = async () => {
    if (inFlight.current || !canSubmit || !template || !liveAllowed.current) return;
    const submission: InvoiceEmailSubmission = { reviewId: crypto.randomUUID(), purpose: props.purpose ?? 'invoice', document: { ...document }, template: { ...template }, recipient: recipient.trim(), content: { subject: content.subject, bodyText: content.bodyText, attachPdf: content.attachPdf } };
    inFlight.current = true;
    setPending(true);
    try {
      setOutcome(await props.onQueue(submission, () => liveAllowed.current));
    } catch {
      setOutcome({ status: 'unknown', submission, message: 'The queue result could not be confirmed. Do not queue this message again; check the original request.' });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const dispatch = async () => {
    if (inFlight.current || outcome?.status !== 'queued' || !props.onDispatch || !liveAllowed.current) return;
    const original = outcome;
    inFlight.current = true; setPending(true);
    try {
      const result = await props.onDispatch(original.submission, original.messageId, () => liveAllowed.current);
      setOutcome(result.status === 'rejected' || result.status === 'queued' ? { status: 'unknown', submission: original.submission,
        message: result.status === 'rejected' ? result.message : 'Dispatch was not confirmed. Check this original request without sending another copy.' } : result);
    }
    catch { setOutcome({ status: 'unknown', submission: original.submission, message: 'The dispatch result is unconfirmed. Check this original request without sending another copy.' }); }
    finally { inFlight.current = false; setPending(false); }
  };

  const check = async () => {
    if (inFlight.current || !['unknown', 'dispatching'].includes(outcome?.status ?? '') || !submitted || !canCheckOriginal) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const checked = await props.onCheck(submitted);
      setOutcome(checked.status === 'rejected' ? { status: 'unknown', submission: submitted, message: checked.message } : checked);
    } catch {
      setOutcome({ status: 'unknown', submission: submitted, message: 'The original queue request is still unconfirmed. No new message was queued.' });
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  const reviewPdf = async () => {
    if (pdfPending || !sourceReady || locked) return;
    setPdfPending(true);
    setPdfError(null);
    try { await props.onReviewPdf(document); }
    catch (error) { setPdfError(error instanceof Error ? error.message : 'The PDF could not be opened.'); }
    finally { setPdfPending(false); }
  };

  const close = () => { if (!inFlight.current && !pdfPending) props.onClose(); };
  const visible = sourceReady || submitted !== null && !sourceChanged && templateState.status === 'ready' && props.canQueue;
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" data-testid="invoice-email-review">
        <DialogHeader className="shrink-0 border-b p-5 pr-16">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold"><Mail className="size-5" />{props.purpose === 'reminder' ? 'Review payment reminder' : 'Review invoice email'}</DialogTitle>
          <DialogDescription>Review the recipient and exact message before adding one email to the queue.</DialogDescription>
          <Button className="absolute right-3 top-3 min-h-11 min-w-11" size="icon" variant="ghost" onClick={close} disabled={pending || checking || pdfPending} aria-label="Close email review"><X className="size-4" /></Button>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5 space-y-5">
          {sourceChanged ? <div role="alert" className="rounded-lg border p-4 text-sm"><p>The selected company, invoice or readable document data changed. This review still belongs to {document.reference} in {document.companyName}. Return to the original document to continue or check its queue result.</p>{!submitted && !pending && !checking && props.onRefreshDocument ? <Button variant="outline" className="mt-3 min-h-11" onClick={props.onRefreshDocument}>Review current document</Button> : null}</div> : null}
          {!props.canQueue ? <div role="status" className="rounded-lg border p-4 text-sm">Email template read/write and message read access are required to review and confirm this queue request.</div> : null}
          {!document.posted ? <div role="status" className="rounded-lg border p-4 text-sm">Post this customer invoice or credit note before preparing its email.</div> : null}
          <ModuleDataNotice state={templateState} />
          {templateState.status === 'loading' ? <p role="status" className="text-sm text-muted-foreground">Loading email templates…</p> : null}
          {submitted && !visible ? <section role="status" className="rounded-lg border p-4 text-sm"><p className="font-medium">Original queue review retained</p><p className="mt-2 break-words">{document.reference} · Review {submitted.reviewId}</p><p className="mt-2">{outcome?.status === 'queued' ? 'Its queue record was confirmed. Sending and delivery are not confirmed.' : outcome?.status === 'dispatched' ? 'The dispatcher recorded this exact message as sent. Recipient delivery is not confirmed.' : 'Its result is unknown. No new copy will be queued. Check the original request when message read access is available in its original company.'}</p></section> : null}
          {visible ? <>
            <section className="rounded-xl border bg-muted/20 p-4" aria-label="Invoice email document">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium break-words">{document.reference}</p><p className="mt-1 break-words text-sm text-muted-foreground">{document.partner} · {document.totalLabel}</p><p className="mt-1 break-words text-xs text-muted-foreground">{document.companyName}</p></div>
                <Button variant="outline" className="min-h-11" onClick={() => void reviewPdf()} disabled={locked || pdfPending || !sourceReady}><Download className="mr-2 size-4" />{pdfPending ? 'Loading PDF…' : 'Review PDF'}</Button>
              </div>
              <p className="mt-3 break-words text-xs text-muted-foreground">Document: {document.pdfFilename}. {(submitted ? invoiceEmailContent(submitted).attachPdf : content.attachPdf) ? 'The managed invoice PDF will be attached when this exact reviewed email is dispatched.' : 'The PDF is not attached to this email.'}</p>
              {pdfError ? <p role="alert" className="mt-2 text-sm text-destructive">{pdfError}</p> : null}
            </section>
            {submitted ? <section className="space-y-2 rounded-lg border p-4 text-sm" role={outcome?.status === 'unknown' || outcome?.status === 'dispatching' ? 'alert' : 'status'} data-testid="invoice-email-result">
              <p className="font-medium">{outcome?.status === 'queued' ? 'Email queue confirmed' : outcome?.status === 'dispatched' ? 'Email dispatch recorded' : outcome?.status === 'dispatching' ? 'Dispatch status unconfirmed' : 'Queue status unknown'}</p>
              <p className="break-words">To: {submitted.recipient}</p><p className="break-words">Template: {submitted.template.name}</p>
              {outcome?.status === 'queued' ? <p>Message #{String(outcome.messageId)} is queued. Sending and delivery are not confirmed.</p> : outcome?.status === 'dispatched' ? <p>The dispatcher recorded message #{String(outcome.messageId)} as sent. Recipient delivery is not confirmed.</p> : outcome?.status === 'unknown' ? <p>{outcome.message}</p> : outcome?.status === 'dispatching' ? <p>This request is claimed. Provider acceptance is unconfirmed. Check the original request; another copy cannot be dispatched automatically.</p> : null}
              <p className="text-xs text-muted-foreground">Original review: {submitted.reviewId}. This review cannot queue another copy.</p>
            </section> : <>
              {outcome?.status === 'rejected' ? <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{outcome.message}</p> : null}
              <div className="space-y-2"><Label htmlFor="invoice-email-recipient">Recipient email</Label><Input id="invoice-email-recipient" data-testid="invoice-email-recipient" type="email" autoComplete="email" className="min-h-11" value={recipient} disabled={locked} onChange={(event) => setRecipient(event.target.value)} aria-invalid={Boolean(recipientProblem)} />{recipientProblem ? <p className="text-sm text-destructive">{recipientProblem}</p> : null}</div>
              <div className="space-y-2"><Label htmlFor="invoice-email-template">Email template</Label><select id="invoice-email-template" data-testid="invoice-email-template" className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedId} disabled={locked || templates.length === 0} onChange={(event) => setTemplateId(event.target.value)}><option value="">Choose a template</option>{templates.map((row) => <option key={String(row.id)} value={String(row.id)}>{row.name} · {row.companyId === undefined ? 'Organization' : 'Company'}</option>)}</select>{templates.length === 0 ? <p className="text-sm text-muted-foreground">No active account-move email template is available for this company or organization.</p> : null}</div>
              {templateProblem ? <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{templateProblem}</p> : null}
            </>}
            {(submitted?.template ?? template) ? <section className="min-w-0 space-y-3" aria-label="Plain text email preview">
              {submitted ? <><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewed subject</p><p className="mt-1 break-words text-sm font-medium">{invoiceEmailContent(submitted).subject}</p></div><pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-4 font-sans text-sm [overflow-wrap:anywhere]" data-testid="invoice-email-body">{invoiceEmailContent(submitted).bodyText}</pre></> : <>
                <div className="space-y-2"><Label htmlFor="invoice-email-subject">Subject</Label><Input id="invoice-email-subject" value={content.subject} disabled={locked} onChange={(event) => edit({ subject: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="invoice-email-body">Message · plain text</Label><Textarea id="invoice-email-body" data-testid="invoice-email-body" className="min-h-40" value={content.bodyText} disabled={locked} onChange={(event) => edit({ bodyText: event.target.value })} /></div>
                <Label className="flex min-h-11 items-center gap-3 rounded-lg border p-3 font-normal" htmlFor="invoice-email-attach"><Checkbox id="invoice-email-attach" aria-label="Attach the managed invoice PDF" checked={content.attachPdf} disabled={locked} onCheckedChange={(checked) => edit({ attachPdf: checked === true })} /><span>Attach the managed invoice PDF</span></Label>
                {contentProblem ? <p role="alert" className="text-sm text-destructive">{contentProblem}</p> : null}
              </>}
              <p className="text-xs text-muted-foreground">The exact text above is sent literally. Formatting tags and placeholders are not executed or expanded. Queueing and provider acceptance do not confirm recipient delivery.</p>
            </section> : null}
            {!submitted ? <Label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal" htmlFor="invoice-email-reviewed"><Checkbox id="invoice-email-reviewed" aria-labelledby="invoice-email-reviewed-label" className="mt-0.5" checked={reviewed} disabled={locked || !template || Boolean(templateProblem) || Boolean(contentProblem) || Boolean(recipientProblem) || !recipient.trim()} onCheckedChange={(checked) => setReviewedKey(checked && contentKey ? contentKey : null)} /><span id="invoice-email-reviewed-label" className="text-sm leading-5">I reviewed this recipient, exact message, invoice context and PDF attachment choice. I understand queueing does not confirm sending.</span></Label> : null}
          </> : null}
        </div>
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/20 p-4 sm:flex-row sm:justify-end">
          <Button variant="outline" className="min-h-11" onClick={close} disabled={pending || checking || pdfPending}>Close review</Button>
          {!submitted ? <Button variant="ghost" className="min-h-11" onClick={props.onReloadTemplates} disabled={pending || checking || sourceChanged}>Reload templates</Button> : null}
          {outcome?.status === 'unknown' || outcome?.status === 'dispatching' ? <Button className="min-h-11" onClick={() => void check()} disabled={checking || !canCheckOriginal} data-testid="invoice-email-check"><RefreshCw className="mr-2 size-4" />{checking ? 'Checking original request…' : 'Check queue status'}</Button> : outcome?.status !== 'queued' && outcome?.status !== 'dispatched' ? <Button className="min-h-11" onClick={() => void queue()} disabled={!canSubmit} data-testid="invoice-email-queue"><Mail className="mr-2 size-4" />{pending ? 'Queueing email…' : 'Queue email'}</Button> : outcome?.status === 'queued' && props.onDispatch ? <Button className="min-h-11" onClick={() => void dispatch()} disabled={pending || !sourceReady} data-testid="invoice-email-dispatch">{pending ? 'Dispatching reviewed email…' : 'Send reviewed email'}</Button> : <span className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><Check className="size-4" />{outcome.status === 'dispatched' ? 'Dispatch recorded' : 'Queue confirmed'}</span>}
        </footer>
      </DialogContent>
    </Dialog>
    {navigationDialog}
  </>;
}
