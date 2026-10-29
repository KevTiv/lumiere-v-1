import { i18n } from "@lumiere/i18n"
import type { AccountMove, MailMessage, MailTemplate } from '@lumiere/stdb/types';
import { variantTag } from '@lumiere/erp-workflows';

export type InvoiceEmailTemplate = Pick<MailTemplate, 'id' | 'organizationId' | 'companyId' | 'name' | 'model' | 'subject' | 'bodyHtml' | 'attachDocument' | 'isDefault' | 'isActive'>;
export type InvoiceEmailMessage = Pick<MailMessage, 'id' | 'organizationId' | 'model' | 'resId' | 'body' | 'metadata'>;

export interface InvoiceEmailDocument {
  organizationId: AccountMove['organizationId'];
  companyId: AccountMove['companyId'];
  moveId: AccountMove['id'];
  reference: string;
  partner: string;
  companyName: string;
  totalLabel: string;
  pdfFilename: string;
  posted: boolean;
  revision: string;
}

export interface InvoiceEmailSubmission {
  reviewId: string;
  purpose?: 'invoice' | 'reminder';
  document: InvoiceEmailDocument;
  template: InvoiceEmailTemplate;
  recipient: string;
  /** Exact plain text approved for this one send; original template remains revision evidence. */
  content?: { subject: string; bodyText: string; attachPdf: boolean };
}

export type InvoiceEmailQueueOutcome =
  | { status: 'queued'; submission: InvoiceEmailSubmission; messageId: MailMessage['id'] }
  | { status: 'dispatching'; submission: InvoiceEmailSubmission; messageId: MailMessage['id'] }
  | { status: 'dispatched'; submission: InvoiceEmailSubmission; messageId: MailMessage['id'] }
  | { status: 'unknown'; submission: InvoiceEmailSubmission; message: string }
  | { status: 'rejected'; message: string };

function object(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own<Key extends string>(value: object, key: Key): value is object & { [Field in Key]: unknown } {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function field(value: object, camel: string, snake = camel): unknown {
  if (own(value, camel)) return value[camel];
  if (own(value, snake)) return value[snake];
  throw new Error(i18n.t("accounting.invoiceEmailReview.emailReviewFieldValueIsUnavailable", { defaultValue: "Email review field {{camel}} is unavailable.", camel: camel }));
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(i18n.t("accounting.invoiceEmailReview.emailReviewValueIsUnavailable", { defaultValue: "Email review {{name}} is unavailable.", name: name }));
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(i18n.t("accounting.invoiceEmailReview.emailReviewValueIsUnavailable", { defaultValue: "Email review {{name}} is unavailable.", name: name }));
  return value;
}

function id(value: unknown): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(i18n.t("accounting.invoiceEmailReview.emailReviewContainsAnUnsafeID", { defaultValue: "Email review contains an unsafe ID." }));
  if (!['string', 'number', 'bigint'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) throw new Error(i18n.t("accounting.invoiceEmailReview.emailReviewIDIsUnavailable", { defaultValue: "Email review ID is unavailable." }));
  const parsed = BigInt(String(value));
  if (parsed > 18446744073709551615n) throw new Error(i18n.t("accounting.invoiceEmailReview.emailReviewIDIsOutOfRange", { defaultValue: "Email review ID is out of range." }));
  return parsed;
}

/** Normalize canonical template fields once; omitted/redacted scope never becomes organization inheritance. */
export function parseInvoiceEmailTemplates(payload: unknown): InvoiceEmailTemplate[] {
  if (!object(payload) || !own(payload, 'data') || !Array.isArray(payload.data)) throw new Error(i18n.t("accounting.invoiceEmailReview.emailTemplatesCouldNotBeRead", { defaultValue: "Email templates could not be read." }));
  return payload.data.map((value: unknown) => {
    if (!object(value)) throw new Error(i18n.t("accounting.invoiceEmailReview.emailTemplateIsMalformed", { defaultValue: "Email template is malformed." }));
    const company = field(value, 'companyId', 'company_id');
    return {
      id: id(field(value, 'id')), organizationId: id(field(value, 'organizationId', 'organization_id')),
      companyId: company === null ? undefined : id(company),
      name: text(field(value, 'name'), 'template name'), model: text(field(value, 'model'), 'template model'),
      subject: text(field(value, 'subject'), 'subject'), bodyHtml: text(field(value, 'bodyHtml', 'body_html'), 'body'),
      attachDocument: bool(field(value, 'attachDocument', 'attach_document'), 'attachment capability'),
      isDefault: bool(field(value, 'isDefault', 'is_default'), 'default template'),
      isActive: bool(field(value, 'isActive', 'is_active'), 'active template'),
    };
  });
}

export function parseInvoiceEmailMessages(payload: unknown, document: InvoiceEmailDocument): InvoiceEmailMessage[] {
  if (!object(payload) || !own(payload, 'data') || !Array.isArray(payload.data)) throw new Error(i18n.t("accounting.invoiceEmailReview.emailQueueRecordsCouldNotBeRead", { defaultValue: "Email queue records could not be read." }));
  return payload.data.flatMap((value: unknown) => {
    if (!object(value)) throw new Error(i18n.t("accounting.invoiceEmailReview.emailQueueRecordIsMalformed", { defaultValue: "Email queue record is malformed." }));
    // Chatter/notifications may use res_id=0. Only this record can prove this queue effect.
    if (field(value, 'model') !== 'account_move' || String(field(value, 'organizationId', 'organization_id')) !== String(document.organizationId)
      || String(field(value, 'resId', 'res_id')) !== String(document.moveId)) return [];
    const metadata = field(value, 'metadata');
    return [{
      id: id(field(value, 'id')), organizationId: id(field(value, 'organizationId', 'organization_id')),
      model: text(field(value, 'model'), 'message model'), resId: id(field(value, 'resId', 'res_id')),
      body: text(field(value, 'body'), 'message body'), metadata: metadata === null ? undefined : text(metadata, 'message metadata'),
    }];
  });
}

export function invoiceEmailScope(document: Pick<InvoiceEmailDocument, 'organizationId' | 'companyId' | 'moveId'>): string {
  return `${document.organizationId}:${document.companyId}:${document.moveId}`;
}

export function invoiceEmailDocumentKey(document: InvoiceEmailDocument): string {
  return JSON.stringify([invoiceEmailScope(document), document.revision, document.reference, document.partner, document.totalLabel, document.posted]);
}

/** Canonical issued fields must still match the reviewed record immediately before queueing. */
export function invoiceEmailRecordRevision(row: Partial<Pick<AccountMove, 'state' | 'moveType' | 'amountTotal' | 'currencyId' | 'name' | 'invoicePartnerDisplayName' | 'metadata'>>): string {
  return JSON.stringify([variantTag(row.state), variantTag(row.moveType), row.amountTotal ?? null, String(row.currencyId ?? ''), row.name ?? '', row.invoicePartnerDisplayName ?? '', row.metadata ?? null]);
}

export function invoiceEmailTemplates(rows: readonly InvoiceEmailTemplate[], document: InvoiceEmailDocument): InvoiceEmailTemplate[] {
  return rows.filter((row) => row.organizationId === document.organizationId && row.model === 'account_move' && row.isActive
    && (row.companyId === undefined || row.companyId === document.companyId))
    .slice().sort((left, right) => Number(right.companyId !== undefined) - Number(left.companyId !== undefined) || left.name.localeCompare(right.name));
}

/** Multiple eligible defaults require a deliberate choice, never the first query row. */
export function defaultInvoiceEmailTemplate(rows: readonly InvoiceEmailTemplate[], document: InvoiceEmailDocument): bigint | undefined {
  const eligible = invoiceEmailTemplates(rows, document);
  for (const company of [document.companyId, undefined]) {
    const defaults = eligible.filter((row) => row.companyId === company && row.isDefault);
    if (defaults.length > 1) return undefined;
    if (defaults.length === 1) return defaults[0]?.id;
  }
  return eligible.length === 1 ? eligible[0]?.id : undefined;
}

export function invoiceEmailTemplateProblem(template: InvoiceEmailTemplate): string | null {
  if (new TextEncoder().encode(template.subject).length > 4096 || new TextEncoder().encode(template.bodyHtml).length > 65_536) return i18n.t("accounting.invoiceEmailReview.thisTemplateExceedsTheSupportedEmailReviewSizeShortenIts", { defaultValue: "This template exceeds the supported email review size. Shorten its subject or body before queueing." });
  if (!template.subject.trim() || !template.bodyHtml.trim()) return i18n.t("accounting.invoiceEmailReview.theTemplateNeedsASubjectAndMessageBodyBeforeIt", { defaultValue: "The template needs a subject and message body before it can be queued." });
  if (/\{\{|\$\{|\{%|\bt-(?:esc|out|field)\s*=/.test(`${template.subject}\n${template.bodyHtml}`)) return i18n.t("accounting.invoiceEmailReview.thisTemplateContainsPlaceholdersTheyAreNotExpandedByThe", { defaultValue: "This template contains placeholders. They are not expanded by the current email transport. Choose a template with complete literal text." });
  return null;
}

export function sameInvoiceEmailTemplate(left: InvoiceEmailTemplate, right: InvoiceEmailTemplate): boolean {
  return left.id === right.id && left.organizationId === right.organizationId && left.companyId === right.companyId
    && left.model === right.model && left.name === right.name && left.subject === right.subject && left.bodyHtml === right.bodyHtml
    && left.isActive === right.isActive && left.isDefault === right.isDefault && left.attachDocument === right.attachDocument;
}

export function invoiceEmailRecipientProblem(recipient: string): string | null {
  return recipient.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.trim()) ? i18n.t("accounting.invoiceEmailReview.enterOneValidRecipientEmailAddress", { defaultValue: "Enter one valid recipient email address." }) : null;
}

export function invoiceEmailContent(submission: InvoiceEmailSubmission) {
  return submission.content ?? { subject: submission.template.subject, bodyText: submission.template.bodyHtml, attachPdf: false };
}

export function invoiceEmailContentProblem(content: { subject: string; bodyText: string }): string | null {
  if (!content.subject.trim() || !content.bodyText.trim()) return i18n.t("accounting.invoiceEmailReview.enterASubjectAndMessageBeforeQueueing", { defaultValue: "Enter a subject and message before queueing." });
  if (/[\r\n\x00-\x1f\x7f]/.test(content.subject)) return i18n.t("accounting.invoiceEmailReview.theEmailSubjectMustBeASingleLine", { defaultValue: "The email subject must be a single line." });
  if (new TextEncoder().encode(content.subject).length > 4096 || new TextEncoder().encode(content.bodyText).length > 65_536) return i18n.t("accounting.invoiceEmailReview.theReviewedSubjectOrMessageIsTooLong", { defaultValue: "The reviewed subject or message is too long." });
  return null;
}

/** Original template, exact approved text and immutable invoice revision travel together. */
export function invoiceEmailContext(submission: InvoiceEmailSubmission): string {
  return JSON.stringify({ invoiceReview: {
    schemaVersion: submission.content ? 2 : 1, reviewId: submission.reviewId,
    ...(submission.purpose ? { purpose: submission.purpose } : {}),
    organizationId: String(submission.document.organizationId), companyId: String(submission.document.companyId),
    moveId: String(submission.document.moveId), templateId: String(submission.template.id),
    reference: submission.document.reference, pdfFilename: submission.document.pdfFilename, pdfAttached: submission.content?.attachPdf ?? false,
    ...(submission.content ? { subject: submission.content.subject, bodyText: submission.content.bodyText } : {}),
    expectedSubject: submission.template.subject, expectedBodyHtml: submission.template.bodyHtml,
    expectedAttachDocument: submission.template.attachDocument, recordRevision: submission.document.revision,
  } });
}

export function resolveInvoiceEmailQueue(rows: readonly InvoiceEmailMessage[], submission: InvoiceEmailSubmission): { messageId: MailMessage['id']; status: 'queued' | 'dispatching' | 'dispatched' } | undefined {
  const context = invoiceEmailContext(submission);
  const content = invoiceEmailContent(submission);
  const matches = rows.filter((row) => {
    if (row.organizationId !== submission.document.organizationId || row.model !== 'account_move' || row.resId !== submission.document.moveId
      || row.body !== content.bodyText || typeof row.metadata !== 'string') return false;
    let metadata: unknown;
    try { metadata = JSON.parse(row.metadata); } catch { return false; }
    if (!object(metadata)) return false;
    return own(metadata, 'delivery') && (metadata.delivery === 'queued' || metadata.delivery === 'dispatching' || metadata.delivery === 'sent')
      && own(metadata, 'context_json') && metadata.context_json === context
      && own(metadata, 'mail_template_id') && String(metadata.mail_template_id) === String(submission.template.id)
      && own(metadata, 'to') && metadata.to === submission.recipient.trim()
      && own(metadata, 'subject') && metadata.subject === content.subject
      && own(metadata, 'html') && metadata.html === content.bodyText
      && (!submission.content || own(metadata, 'attach_document') && metadata.attach_document === content.attachPdf);
  });
  if (matches.length > 1) throw new Error(i18n.t("accounting.invoiceEmailReview.moreThanOneMessageMatchesThisReviewDoNotQueue", { defaultValue: "More than one message matches this review. Do not queue it again." }));
  const match = matches[0];
  if (!match?.metadata) return undefined;
  const metadata: unknown = JSON.parse(match.metadata);
  return { messageId: match.id, status: object(metadata) && own(metadata, 'delivery') && metadata.delivery === 'sent' ? 'dispatched' : object(metadata) && own(metadata, 'delivery') && metadata.delivery === 'dispatching' ? 'dispatching' : 'queued' };
}
