/**
 * Maps Documents module form payloads to SpacetimeDB reducer param types.
 */

import type {
  CreateDocumentParams,
  CreateDocumentFolderParams,
  CreateDocumentProcessingJobParams,
  CreateKnowledgeArticleParams,
  CreateKnowledgeCategoryParams,
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
