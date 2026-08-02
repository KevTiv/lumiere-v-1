/** Auto-generated Create*Params mappers for crm coverage gap. */

import type {
  ContactIdentityKind,
  CreateAssignmentRuleParams,
  CreateContactIdentityParams,
  CreateContactRelationshipParams,
  CreateCrmForecastSnapshotParams,
  CreateLeadLostReasonParams,
  CreateLeadSourceParams,
  CreateOpportunityStageParams,
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
} from "@lumiere/erp-shared/create-params-helpers"

export function toCreateAssignmentRuleParams(
  formData: Record<string, unknown>,
): CreateAssignmentRuleParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const model = optionalTrimmedString(field(formData, "model", "model"))
  const assignType = optionalTrimmedString(field(formData, "assignType", "assign_type"))
  if (!name || !model || !assignType) return null

  return {
    name,
    model,
    domain: optionalTrimmedString(field(formData, "domain", "domain")),
    assignType,
    userIds: identityArrayFromForm(field(formData, "userIds", "user_ids")),
    teamId: optionalBigIntU64(field(formData, "teamId", "team_id")),
    priority: Math.trunc(num(field(formData, "priority", "priority"), 0)),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateContactIdentityParams(
  formData: Record<string, unknown>,
): CreateContactIdentityParams | null {
  const contactId = optionalBigIntU64(field(formData, "contactId", "contact_id"))
  const rawValue = optionalTrimmedString(field(formData, "rawValue", "raw_value"))
  if (contactId === undefined || !rawValue) return null

  return {
    kind: unitEnumFromForm<ContactIdentityKind>(field(formData, "kind", "kind"), ["Primary", "WhatsApp", "MobileMoney"] as const, "Primary"),
    verificationState: undefined,
    contactId,
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    rawValue,
    isPreferred: field(formData, "isPreferred", "is_preferred") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateContactRelationshipParams(
  formData: Record<string, unknown>,
): CreateContactRelationshipParams | null {
  const leftContactId = optionalBigIntU64(field(formData, "leftContactId", "left_contact_id"))
  const rightContactId = optionalBigIntU64(field(formData, "rightContactId", "right_contact_id"))
  const relationshipType = optionalTrimmedString(field(formData, "relationshipType", "relationship_type"))
  if (leftContactId === undefined || rightContactId === undefined || !relationshipType) return null

  return {
    leftContactId,
    rightContactId,
    relationshipType,
    startDate: optionalTimestampFromForm(field(formData, "startDate", "start_date")),
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateCrmForecastSnapshotParams(
  formData: Record<string, unknown>,
): CreateCrmForecastSnapshotParams | null {
  return {
    periodStart: requiredTimestampFromForm(field(formData, "periodStart", "period_start")) ?? stbTimestampFromDate(new Date()),
    periodEnd: requiredTimestampFromForm(field(formData, "periodEnd", "period_end")) ?? stbTimestampFromDate(new Date()),
    ownerId: optionalIdentityFromForm(field(formData, "ownerId", "owner_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateLeadLostReasonParams(
  formData: Record<string, unknown>,
): CreateLeadLostReasonParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateLeadSourceParams(
  formData: Record<string, unknown>,
): CreateLeadSourceParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateOpportunityStageParams(
  formData: Record<string, unknown>,
): CreateOpportunityStageParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    probability: num(field(formData, "probability", "probability"), 0),
    requirements: optionalTrimmedString(field(formData, "requirements", "requirements")),
    fold: Boolean(field(formData, "fold", "fold")),
    isWon: Boolean(field(formData, "isWon", "is_won")),
    teamId: optionalBigIntU64(field(formData, "teamId", "team_id")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
