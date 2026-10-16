'use client';

import { useRef, useState } from 'react';
import { Check, Download, Mail, RefreshCw, X } from 'lucide-react';
import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/dialog';
import { Input } from '../components/input';
import { Label } from '../components/label';
import { useUnsavedChangesGuard } from '../forms/use-unsaved-changes-guard';
import type { ModuleDataState } from '../lib/module-data-state';
import { ModuleDataNotice } from '../pages/module-data-notice';
import {
  defaultInvoiceEmailTemplate, invoiceEmailDocumentKey, invoiceEmailRecipientProblem, invoiceEmailScope,
  invoiceEmailTemplateProblem, invoiceEmailTemplates,
  type InvoiceEmailDocument, type InvoiceEmailQueueOutcome, type InvoiceEmailSubmission, type InvoiceEmailTemplate,
} from './invoice-email-review';

export interface InvoiceEmailReviewDialogProps {
  open: boolean;
  document: InvoiceEmailDocument;
  currentScopeKey: string;
  currentDocumentKey: string | null;
  templates: readonly InvoiceEmailTemplate[];
  templateState: ModuleDataState;
  canQueue: boolean;
  canCheck: boolean;
  onQueue: (submission: InvoiceEmailSubmission, mayDispatch: () => boolean) => Promise<InvoiceEmailQueueOutcome>;
  onCheck: (submission: InvoiceEmailSubmission) => Promise<InvoiceEmailQueueOutcome>;
  onReviewPdf: (document: InvoiceEmailDocument) => Promise<void>;
  onReloadTemplates: () => void;
  onRefreshDocument?: () => void;
  onClose: () => void;
}

/** Review and queue one literal message. This component has no dispatch or attachment transport. */
export function InvoiceEmailReviewDialog(props: InvoiceEmailReviewDialogProps) {
  const { open, templateState } = props;
  // The parent may change route/company props while a request is in flight.
  // A review instance always remains bound to its original immutable document context.
  const [document] = useState<InvoiceEmailDocument>(() => ({ ...props.document }));
  const [recipient, setRecipient] = useState('');
  const [templateId, setTemplateId] = useState('');
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
  const submitted = outcome?.status === 'queued' || outcome?.status === 'dispatched' || outcome?.status === 'unknown' ? outcome.submission : null;
  const locked = pending || checking || submitted !== null;
  const templates = invoiceEmailTemplates(props.templates, document);
  const selectedId = templateId || String(defaultInvoiceEmailTemplate(templates, document) ?? '');
  const template = templates.find((row) => String(row.id) === selectedId);
  const recipientProblem = recipient.trim() ? invoiceEmailRecipientProblem(recipient) : null;
  const templateProblem = template ? invoiceEmailTemplateProblem(template) : null;
  const contentKey = template ? JSON.stringify([invoiceEmailDocumentKey(document), String(template.id), template.subject, template.bodyHtml, template.attachDocument, recipient.trim()]) : null;
  const reviewed = contentKey !== null && reviewedKey === contentKey;
  const canSubmit = sourceReady && !locked && !pdfPending && template !== undefined && !templateProblem && recipient.trim() !== '' && !recipientProblem && reviewed;
  const navigationDialog = useUnsavedChangesGuard(recipient.trim() !== '' && outcome?.status !== 'queued' && outcome?.status !== 'dispatched' || outcome?.status === 'unknown', pending || checking);

  const queue = async () => {
    if (inFlight.current || !canSubmit || !template || !liveAllowed.current) return;
    const submission: InvoiceEmailSubmission = { reviewId: crypto.randomUUID(), document: { ...document }, template: { ...template }, recipient: recipient.trim() };
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

  const check = async () => {
    if (inFlight.current || outcome?.status !== 'unknown' || !canCheckOriginal) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const checked = await props.onCheck(outcome.submission);
      setOutcome(checked.status === 'rejected' ? { status: 'unknown', submission: outcome.submission, message: checked.message } : checked);
    } catch {
      setOutcome({ status: 'unknown', submission: outcome.submission, message: 'The original queue request is still unconfirmed. No new message was queued.' });
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
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold"><Mail className="size-5" />Review invoice email</DialogTitle>
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
              <p className="mt-3 break-words text-xs text-muted-foreground">Document: {document.pdfFilename}. The PDF is not attached to this email.</p>
              {pdfError ? <p role="alert" className="mt-2 text-sm text-destructive">{pdfError}</p> : null}
            </section>
            {submitted ? <section className="space-y-2 rounded-lg border p-4 text-sm" role={outcome?.status === 'unknown' ? 'alert' : 'status'} data-testid="invoice-email-result">
              <p className="font-medium">{outcome?.status === 'queued' ? 'Email queue confirmed' : outcome?.status === 'dispatched' ? 'Email dispatch recorded' : 'Queue status unknown'}</p>
              <p className="break-words">To: {submitted.recipient}</p><p className="break-words">Template: {submitted.template.name}</p>
              {outcome?.status === 'queued' ? <p>Message #{String(outcome.messageId)} is queued. Sending and delivery are not confirmed.</p> : outcome?.status === 'dispatched' ? <p>The dispatcher recorded message #{String(outcome.messageId)} as sent. Recipient delivery is not confirmed.</p> : outcome?.status === 'unknown' ? <p>{outcome.message}</p> : null}
              <p className="text-xs text-muted-foreground">Original review: {submitted.reviewId}. This review cannot queue another copy.</p>
            </section> : <>
              {outcome?.status === 'rejected' ? <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{outcome.message}</p> : null}
              <div className="space-y-2"><Label htmlFor="invoice-email-recipient">Recipient email</Label><Input id="invoice-email-recipient" data-testid="invoice-email-recipient" type="email" autoComplete="email" className="min-h-11" value={recipient} disabled={locked} onChange={(event) => setRecipient(event.target.value)} aria-invalid={Boolean(recipientProblem)} />{recipientProblem ? <p className="text-sm text-destructive">{recipientProblem}</p> : null}</div>
              <div className="space-y-2"><Label htmlFor="invoice-email-template">Email template</Label><select id="invoice-email-template" data-testid="invoice-email-template" className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedId} disabled={locked || templates.length === 0} onChange={(event) => setTemplateId(event.target.value)}><option value="">Choose a template</option>{templates.map((row) => <option key={String(row.id)} value={String(row.id)}>{row.name} · {row.companyId === undefined ? 'Organization' : 'Company'}</option>)}</select>{templates.length === 0 ? <p className="text-sm text-muted-foreground">No active account-move email template is available for this company or organization.</p> : null}</div>
              {templateProblem ? <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{templateProblem}</p> : null}
            </>}
            {(submitted?.template ?? template) ? <section className="min-w-0 space-y-3" aria-label="Literal email preview">
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject · read only</p><p className="mt-1 break-words text-sm font-medium">{(submitted?.template ?? template)?.subject}</p></div>
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Body · sent as literal plain text</p><pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 font-sans text-sm [overflow-wrap:anywhere]" data-testid="invoice-email-body">{(submitted?.template ?? template)?.bodyHtml}</pre></div>
              <p className="text-xs text-muted-foreground">Message text comes from the selected template. Formatting tags and placeholders are not converted or expanded. PDF attachments and delivery tracking are unavailable.</p>
            </section> : null}
            {!submitted ? <Label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal" htmlFor="invoice-email-reviewed"><Checkbox id="invoice-email-reviewed" aria-labelledby="invoice-email-reviewed-label" className="mt-0.5" checked={reviewed} disabled={locked || !template || Boolean(templateProblem) || Boolean(recipientProblem) || !recipient.trim()} onCheckedChange={(checked) => setReviewedKey(checked && contentKey ? contentKey : null)} /><span id="invoice-email-reviewed-label" className="text-sm leading-5">I reviewed this recipient, literal message and invoice context. I understand the PDF is not attached and queueing does not confirm sending.</span></Label> : null}
          </> : null}
        </div>
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/20 p-4 sm:flex-row sm:justify-end">
          <Button variant="outline" className="min-h-11" onClick={close} disabled={pending || checking || pdfPending}>Close review</Button>
          {!submitted ? <Button variant="ghost" className="min-h-11" onClick={props.onReloadTemplates} disabled={pending || checking || sourceChanged}>Reload templates</Button> : null}
          {outcome?.status === 'unknown' ? <Button className="min-h-11" onClick={() => void check()} disabled={checking || !canCheckOriginal} data-testid="invoice-email-check"><RefreshCw className="mr-2 size-4" />{checking ? 'Checking original request…' : 'Check queue status'}</Button> : outcome?.status !== 'queued' && outcome?.status !== 'dispatched' ? <Button className="min-h-11" onClick={() => void queue()} disabled={!canSubmit} data-testid="invoice-email-queue"><Mail className="mr-2 size-4" />{pending ? 'Queueing email…' : 'Queue email'}</Button> : <span className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><Check className="size-4" />{outcome.status === 'dispatched' ? 'Dispatch recorded' : 'Queue confirmed'}</span>}
        </footer>
      </DialogContent>
    </Dialog>
    {navigationDialog}
  </>;
}
