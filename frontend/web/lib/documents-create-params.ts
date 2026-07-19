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
  const fileName =
    requiredTrimmedString(formData.fileName) ??
    requiredTrimmedString(formData.uploadedFileName)
  const url = requiredTrimmedString(formData.url)
  const checksum = requiredTrimmedString(formData.checksum)
  if (!name || !fileName || !url || !checksum) return null

  const fileSizeRaw = formData.fileSize
  const fileSize =
    typeof fileSizeRaw === "bigint"
      ? fileSizeRaw
      : typeof fileSizeRaw === "number"
        ? BigInt(fileSizeRaw)
        : typeof fileSizeRaw === "string" && fileSizeRaw.trim() !== ""
          ? BigInt(fileSizeRaw)
          : null
  if (fileSize === null || fileSize <= 0n) return null

  const mimetype =
    optionalTrimmedString(formData.mimetype) ?? "application/octet-stream"

  const retentionRaw = formData.retentionDays
  const retentionDays =
    retentionRaw != null && String(retentionRaw).trim() !== ""
      ? Math.max(0, Math.floor(Number(retentionRaw)))
      : undefined

  return {
    name,
    description: optionalTrimmedString(formData.description),
    fileName,
    fileSize,
    mimetype,
    url,
    checksum,
    folderId: optionalBigIntU64(formData.folderId),
    resModel: optionalTrimmedString(formData.resModel),
    resId: optionalBigIntU64(formData.resId),
    partnerId: optionalBigIntU64(formData.partnerId),
    tagIds: u64IdArrayFromForm(formData.tagIds),
    isFavorite: Boolean(formData.isFavorite),
    indexContent: optionalTrimmedString(formData.indexContent),
    classificationId: optionalBigIntU64(formData.classificationId),
    retentionDays:
      retentionDays === undefined || Number.isNaN(retentionDays)
        ? undefined
        : retentionDays,
    fiscalKind: optionalTrimmedString(formData.fiscalKind),
    residencyRegion: optionalTrimmedString(formData.residencyRegion),
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
    isPublished: Boolean(formData.isPublished),
    websiteUrl: undefined,
    metadata: undefined,
  }
}

export function toUpdateKnowledgeArticleParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): Record<string, unknown> {
  return {
    companyId,
    name: optionalTrimmedString(formData.name),
    description: optionalTrimmedString(formData.description),
    body: optionalTrimmedString(formData.body),
    categoryId: optionalBigIntU64(formData.categoryId),
    isPublished:
      formData.isPublished === undefined ? undefined : Boolean(formData.isPublished),
    websiteUrl: optionalTrimmedString(formData.websiteUrl),
  }
}

export function toAddDocumentVersionParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const fileName =
    requiredTrimmedString(formData.fileName) ??
    requiredTrimmedString(formData.uploadedFileName)
  const url = requiredTrimmedString(formData.url)
  const checksum = requiredTrimmedString(formData.checksum)
  if (!fileName || !url || !checksum) return null
  const fileSizeRaw = formData.fileSize
  const fileSize =
    typeof fileSizeRaw === "bigint"
      ? fileSizeRaw
      : typeof fileSizeRaw === "number"
        ? BigInt(fileSizeRaw)
        : typeof fileSizeRaw === "string" && fileSizeRaw.trim() !== ""
          ? BigInt(fileSizeRaw)
          : null
  if (fileSize === null || fileSize <= 0n) return null
  return {
    fileName,
    fileSize,
    mimetype: optionalTrimmedString(formData.mimetype) ?? "application/octet-stream",
    url,
    checksum,
    changesDescription: optionalTrimmedString(formData.changesDescription),
  }
}

export function toUpdateDocumentFolderParams(
  formData: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: optionalTrimmedString(formData.name),
    description: optionalTrimmedString(formData.description),
    parentId: optionalBigIntU64(formData.parentId),
    sequence:
      formData.sequence != null && String(formData.sequence).trim() !== ""
        ? Math.max(0, Math.floor(Number(formData.sequence)))
        : undefined,
    isAccessRestricted:
      formData.isAccessRestricted === undefined
        ? undefined
        : Boolean(formData.isAccessRestricted),
    isHidden: formData.isHidden === undefined ? undefined : Boolean(formData.isHidden),
    isReadonly:
      formData.isReadonly === undefined ? undefined : Boolean(formData.isReadonly),
    isFavorite:
      formData.isFavorite === undefined ? undefined : Boolean(formData.isFavorite),
    residencyRegion: optionalTrimmedString(formData.residencyRegion),
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
    residencyRegion: optionalTrimmedString(formData.residencyRegion),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toSetDocumentIndexContentParams(
  formData: Record<string, unknown>,
): { content: string; language?: string } | null {
  const content = requiredTrimmedString(formData.content)
  if (!content) return null
  return {
    content,
    language: optionalTrimmedString(formData.language),
  }
}

export function toSetDocumentRetentionParams(
  formData: Record<string, unknown>,
): { classificationId?: bigint; retentionDays?: number } {
  const retentionRaw = formData.retentionDays
  const retentionDays =
    retentionRaw != null && String(retentionRaw).trim() !== ""
      ? Math.max(0, Math.floor(Number(retentionRaw)))
      : undefined
  return {
    classificationId: optionalBigIntU64(formData.classificationId),
    retentionDays:
      retentionDays === undefined || Number.isNaN(retentionDays)
        ? undefined
        : retentionDays,
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
    documentId: optionalBigIntU64(formData.documentId ?? formData.document_id),
    documentVersionId: optionalBigIntU64(
      formData.documentVersionId ?? formData.document_version_id,
    ),
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
