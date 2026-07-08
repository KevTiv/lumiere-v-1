/**
 * Maps Documents module form payloads to SpacetimeDB reducer param types.
 */

import type {
  CreateDocumentParams,
  CreateDocumentFolderParams,
  CreateDocumentProcessingJobParams,
  CreateDocumentTemplateParams,
  CreateKnowledgeArticleParams,
  CreateKnowledgeCategoryParams,
  CreateMailTemplateParams,
} from "@lumiere/stdb/types"

import { optionalBigIntU64, u64IdArrayFromForm } from "@/lib/form-coercion"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredTrimmedString(v: unknown): string | null {
  const s = optionalTrimmedString(v)
  return s ?? null
}

export function toCreateDocumentParams(
  formData: Record<string, unknown>,
): CreateDocumentParams | null {
  const name = requiredTrimmedString(formData.name)
  const fileName = requiredTrimmedString(formData.fileName)
  if (!name || !fileName) return null

  const mimetype = optionalTrimmedString(formData.mimetype) ?? "application/octet-stream"

  return {
    name,
    description: optionalTrimmedString(formData.description),
    fileName,
    fileSize: 0n,
    mimetype,
    url: "",
    folderId: optionalBigIntU64(formData.folderId),
    resModel: undefined,
    resId: undefined,
    partnerId: undefined,
    tagIds: u64IdArrayFromForm(formData.tagIds),
    isFavorite: Boolean(formData.isFavorite),
    metadata: undefined,
  }
}

export function toCreateKnowledgeArticleParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateKnowledgeArticleParams | null {
  const name = requiredTrimmedString(formData.name)
  if (!name) return null

  return {
    companyId,
    name,
    description: optionalTrimmedString(formData.description),
    body: optionalTrimmedString(formData.body),
    icon: undefined,
    color: undefined,
    parentId: optionalBigIntU64(formData.parentId),
    categoryId: optionalBigIntU64(formData.categoryId),
    internalPermission: undefined,
    isArticleItem: false,
    isTodoItem: false,
    sequence: 10,
    articleUrl: undefined,
    websiteUrl: undefined,
    metadata: undefined,
  }
}

export function toCreateKnowledgeCategoryParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateKnowledgeCategoryParams | null {
  const name = requiredTrimmedString(formData.name)
  if (!name) return null
  const seqRaw = formData.sequence
  const sequence =
    seqRaw != null && String(seqRaw).trim() !== "" ? Math.max(0, Math.floor(Number(seqRaw))) : 10
  const colorRaw = formData.color
  const color =
    colorRaw != null && String(colorRaw).trim() !== ""
      ? Math.min(11, Math.max(0, Math.floor(Number(colorRaw))))
      : undefined
  return {
    companyId,
    name,
    description: optionalTrimmedString(formData.description),
    parentId: optionalBigIntU64(formData.parentId),
    sequence,
    color,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateDocumentFolderParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateDocumentFolderParams | null {
  const name = requiredTrimmedString(formData.name)
  if (!name) return null
  const seqRaw = formData.sequence
  const sequence =
    seqRaw != null && String(seqRaw).trim() !== "" ? Math.max(0, Math.floor(Number(seqRaw))) : 10
  return {
    name,
    description: optionalTrimmedString(formData.description),
    parentId: optionalBigIntU64(formData.parentId),
    isAccessRestricted: formData.isAccessRestricted === true,
    isHidden: Boolean(formData.isHidden),
    isReadonly: formData.isReadonly === true,
    isFavorite: Boolean(formData.isFavorite),
    sequence,
    storageId: optionalBigIntU64(formData.storageId),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateDocumentProcessingJobParams(
  formData: Record<string, unknown>,
): CreateDocumentProcessingJobParams {
  return {
    documentType: String(formData.documentType ?? formData.document_type ?? ""),
    jobType: String(formData.jobType ?? formData.job_type ?? ""),
    aiAgentId: optionalBigIntU64(formData.aiAgentId ?? formData.ai_agent_id),
    inputData: optionalTrimmedString(formData.inputData ?? formData.input_data),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateDocumentTemplateParams(
  formData: Record<string, unknown>,
): CreateDocumentTemplateParams | null {
  const name = requiredTrimmedString(formData.name)
  const model = requiredTrimmedString(formData.model)
  const bodyHtml = requiredTrimmedString(formData.bodyHtml ?? formData.body_html)
  if (!name || !model || !bodyHtml) return null
  return {
    name,
    model,
    reportType: String(formData.reportType ?? formData.report_type ?? "qweb-pdf"),
    bodyHtml,
    headerHtml: optionalTrimmedString(formData.headerHtml ?? formData.header_html),
    footerHtml: optionalTrimmedString(formData.footerHtml ?? formData.footer_html),
    variableBindingsJson: optionalTrimmedString(
      formData.variableBindingsJson ?? formData.variable_bindings_json,
    ),
    isDefault: formData.isDefault === true || formData.is_default === true,
    isActive: formData.isActive !== false && formData.is_active !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateMailTemplateParams(
  formData: Record<string, unknown>,
): CreateMailTemplateParams | null {
  const name = requiredTrimmedString(formData.name)
  const model = requiredTrimmedString(formData.model)
  const subject = requiredTrimmedString(formData.subject)
  const bodyHtml = requiredTrimmedString(formData.bodyHtml ?? formData.body_html)
  if (!name || !model || !subject || !bodyHtml) return null
  return {
    name,
    model,
    subject,
    bodyHtml,
    documentTemplateId: optionalBigIntU64(formData.documentTemplateId ?? formData.document_template_id),
    attachDocument: formData.attachDocument === true || formData.attach_document === true,
    isDefault: formData.isDefault === true || formData.is_default === true,
    isActive: formData.isActive !== false && formData.is_active !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}
