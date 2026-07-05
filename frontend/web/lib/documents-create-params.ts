/**
 * Maps Documents module form payloads to SpacetimeDB reducer param types.
 */

import type {
  CreateDocumentParams,
  CreateKnowledgeArticleParams,
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
