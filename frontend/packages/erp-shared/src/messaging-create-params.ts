/** Auto-generated Create*Params mappers for messaging coverage gap. */

import type {
  CreateInvoiceReminderBatchParams,
  CreateMessageBatchParams,
  CreateMessageTemplateParams,
  CreateOperationalMessageParams,
  MessageChannel,
  MessageTemplateVariable,
  OperationalMessageStatus,
} from "@lumiere/stdb/types"

import {
  field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
  num,
  stringArrayFromForm,
  optionalTimestampFromForm,
  requiredTimestampFromForm,
  optionalIdentityFromForm,
  requiredIdentityFromForm,
  identityArrayFromForm,
  unitEnumFromForm,
  unitEnumArrayFromForm,
  messageChannelArrayFromForm,
  objectArrayFromForm,
  stbTimestampFromDate,
} from "./create-params-helpers"

export function toCreateInvoiceReminderBatchParams(
  formData: Record<string, unknown>,
): CreateInvoiceReminderBatchParams | null {
  const templateId = optionalBigIntU64(field(formData, "templateId", "template_id"))
  if (templateId === undefined) return null

  return {
    channel: unitEnumFromForm<MessageChannel>(field(formData, "channel", "channel"), ["Sms", "WhatsApp", "Email", "InApp"] as const, "Sms"),
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    templateId,
    invoiceIds: u64IdArrayFromForm(field(formData, "invoiceIds", "invoice_ids")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateMessageBatchParams(
  formData: Record<string, unknown>,
): CreateMessageBatchParams | null {
  const templateId = optionalBigIntU64(field(formData, "templateId", "template_id"))
  if (templateId === undefined) return null

  return {
    channel: unitEnumFromForm<MessageChannel>(field(formData, "channel", "channel"), ["Sms", "WhatsApp", "Email", "InApp"] as const, "Sms"),
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    templateId,
    subjectModel: optionalTrimmedString(field(formData, "subjectModel", "subject_model")) ?? "",
    subjectQuery: optionalTrimmedString(field(formData, "subjectQuery", "subject_query")),
    candidateContactIds: u64IdArrayFromForm(field(formData, "candidateContactIds", "candidate_contact_ids")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateMessageTemplateParams(
  formData: Record<string, unknown>,
): CreateMessageTemplateParams | null {
  const key = optionalTrimmedString(field(formData, "key", "key"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const locale = optionalTrimmedString(field(formData, "locale", "locale"))
  if (!key || !name || !locale) return null

  return {
    applicableChannels: messageChannelArrayFromForm(field(formData, "applicableChannels", "applicable_channels")) as import("@lumiere/stdb/types").MessageChannel[],
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    key,
    name,
    locale,
    subject: optionalTrimmedString(field(formData, "subject", "subject")),
    bodyTemplate: optionalTrimmedString(field(formData, "bodyTemplate", "body_template")) ?? "",
    allowedVariables: stringArrayFromForm(field(formData, "allowedVariables", "allowed_variables")),
    retentionClassification: optionalTrimmedString(field(formData, "retentionClassification", "retention_classification")) ?? "",
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateOperationalMessageParams(
  formData: Record<string, unknown>,
): CreateOperationalMessageParams | null {
  const templateId = optionalBigIntU64(field(formData, "templateId", "template_id"))
  const contactId = optionalBigIntU64(field(formData, "contactId", "contact_id"))
  if (templateId === undefined || contactId === undefined) return null

  const phoneIdentityId = optionalBigIntU64(field(formData, "phoneIdentityId", "phone_identity_id"))
  const subjectId = optionalBigIntU64(field(formData, "subjectId", "subject_id"))
  if (phoneIdentityId === undefined || subjectId === undefined) return null

  return {
    channel: unitEnumFromForm<MessageChannel>(field(formData, "channel", "channel"), ["Sms", "WhatsApp", "Email", "InApp"] as const, "Sms"),
    variables: objectArrayFromForm(field(formData, "variables", "variables")).map((row) => ({ key: String(row.key ?? ""), value: String(row.value ?? "") })),
    status: unitEnumFromForm<OperationalMessageStatus>(field(formData, "status", "status"), ["Draft", "Copied", "Queued", "Sent", "Delivered", "Failed", "Cancelled"] as const, "Draft"),
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    templateId,
    contactId,
    phoneIdentityId,
    subjectModel: optionalTrimmedString(field(formData, "subjectModel", "subject_model")) ?? "",
    subjectId,
    renderedSubject: optionalTrimmedString(field(formData, "renderedSubject", "rendered_subject")),
    renderedBody: optionalTrimmedString(field(formData, "renderedBody", "rendered_body")) ?? "",
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

