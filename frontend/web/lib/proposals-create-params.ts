/** Auto-generated Create*Params mappers for proposals coverage gap. */

import type {
  CreateProposalClarificationParams,
  CreateProposalClauseParams,
  CreateProposalIntegrationIntentParams,
  CreateProposalParams,
  CreateProposalTemplateParams,
} from "@lumiere/stdb/generated/types"

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
} from "@lumiere/erp-shared/create-params-helpers"

export function toCreateProposalClarificationParams(
  formData: Record<string, unknown>,
): CreateProposalClarificationParams | null {
  const question = optionalTrimmedString(field(formData, "question", "question"))
  if (!question) return null

  return {
    authorName: optionalTrimmedString(field(formData, "authorName", "author_name")) ?? "",
    authorEmail: optionalTrimmedString(field(formData, "authorEmail", "author_email")),
    isPortalPrincipal: Boolean(field(formData, "isPortalPrincipal", "is_portal_principal")),
    question,
  }
}

export function toCreateProposalClauseParams(
  formData: Record<string, unknown>,
): CreateProposalClauseParams | null {
  const clauseKey = optionalTrimmedString(field(formData, "clauseKey", "clause_key"))
  const title = optionalTrimmedString(field(formData, "title", "title"))
  const body = optionalTrimmedString(field(formData, "body", "body"))
  if (!clauseKey || !title || !body) return null

  return {
    clauseKey,
    title,
    body,
    locale: optionalTrimmedString(field(formData, "locale", "locale")) ?? "",
    countryPackKey: optionalTrimmedString(field(formData, "countryPackKey", "country_pack_key")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProposalIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreateProposalIntegrationIntentParams | null {
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const payload = optionalTrimmedString(field(formData, "payload", "payload"))
  if (!intentType || !idempotencyKey || !payload) return null

  return {
    proposalVersionId: optionalBigIntU64(field(formData, "proposalVersionId", "proposal_version_id")),
    intentType,
    idempotencyKey,
    payload,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProposalParams(
  formData: Record<string, unknown>,
): CreateProposalParams | null {
  const title = optionalTrimmedString(field(formData, "title", "title"))
  const clientName = optionalTrimmedString(field(formData, "clientName", "client_name"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (!title || !clientName || currencyId === undefined) return null

  return {
    title,
    clientName,
    currencyId,
    value: num(field(formData, "value", "value"), 0),
    deadline: optionalTimestampFromForm(field(formData, "deadline", "deadline")),
    description: optionalTrimmedString(field(formData, "description", "description")),
    templateId: optionalBigIntU64(field(formData, "templateId", "template_id")),
    partnerId: optionalBigIntU64(field(formData, "partnerId", "partner_id")),
    documentFolderId: optionalBigIntU64(field(formData, "documentFolderId", "document_folder_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProposalTemplateParams(
  formData: Record<string, unknown>,
): CreateProposalTemplateParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const category = optionalTrimmedString(field(formData, "category", "category"))
  const locale = optionalTrimmedString(field(formData, "locale", "locale"))
  if (!name || !category || !locale) return null

  return {
    name,
    category,
    locale,
    countryPackKey: optionalTrimmedString(field(formData, "countryPackKey", "country_pack_key")),
    sectionsJson: optionalTrimmedString(field(formData, "sectionsJson", "sections_json")) ?? "",
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

