import type {
  CreateActivityParams,
  CreateContactCategoryParams,
  CreateContactParams,
  CreateContactSegmentParams,
  CreateContactTagParams,
  CreateLeadParams,
  CreateOpportunityParams,
  UpdateContactCategoryParams,
  UpdateContactCoreParams,
  UpdateLeadAddressParams,
  UpdateLeadDetailsParams,
  UpdateLeadRevenueParams,
  UpdateOpportunityParams,
} from "@lumiere/stdb/types";

import { pickDefined } from "./params-merge-utils";

/** Merge partial CRM create payloads with hook defaults before `stdbParamsToJson`. */
export function finalizeCreateLeadParams(
  partial: Partial<CreateLeadParams>,
): CreateLeadParams {
  return {
    name: partial.name ?? "",
    priority: partial.priority ?? "Medium",
    state: partial.state ?? "new",
    expectedRevenue: partial.expectedRevenue ?? 0,
    probability: partial.probability ?? 0,
    tagIds: partial.tagIds ?? [],
    email: partial.email,
    phone: partial.phone,
    mobile: partial.mobile,
    companyName: partial.companyName,
    contactName: partial.contactName,
    title: partial.title,
    street: partial.street,
    city: partial.city,
    zip: partial.zip,
    countryCode: partial.countryCode,
    website: partial.website,
    industry: partial.industry,
    sourceId: partial.sourceId,
    campaignId: partial.campaignId,
    mediumId: partial.mediumId,
    referredBy: partial.referredBy,
    description: partial.description,
    userId: partial.userId,
    stageId: partial.stageId,
    teamId: partial.teamId,
    partnerId: partial.partnerId,
    dateDeadline: partial.dateDeadline,
    metadata: partial.metadata,
  }
}

export function finalizeCreateOpportunityParams(
  partial: Partial<CreateOpportunityParams>,
): CreateOpportunityParams {
  if (partial.stageId == null || partial.stageId === 0n) {
    throw new Error("stageId is required to create an opportunity")
  }
  return {
    name: partial.name ?? "",
    expectedRevenue: partial.expectedRevenue ?? 0,
    probability: partial.probability ?? 0,
    stageId: partial.stageId,
    priority: partial.priority ?? "Medium",
    isWon: partial.isWon ?? false,
    isLost: partial.isLost ?? false,
    tagIds: partial.tagIds ?? [],
    leadId: partial.leadId,
    partnerId: partial.partnerId,
    contactId: partial.contactId,
    campaignId: partial.campaignId,
    mediumId: partial.mediumId,
    sourceId: partial.sourceId,
    userId: partial.userId,
    teamId: partial.teamId,
    companyId: partial.companyId,
    companyCurrencyId: partial.companyCurrencyId,
    lostReasonId: partial.lostReasonId,
    dateOpen: partial.dateOpen,
    dateClosed: partial.dateClosed,
    dateDeadline: partial.dateDeadline,
    dateLastStageUpdate: partial.dateLastStageUpdate,
    dayOpen: partial.dayOpen,
    dayClose: partial.dayClose,
    color: partial.color,
    description: partial.description,
    metadata: partial.metadata,
  }
}

export function finalizeCreateContactParams(
  partial: Partial<CreateContactParams>,
): CreateContactParams {
  return {
    name: partial.name ?? "",
    type: partial.type ?? "contact",
    email: partial.email,
    phone: partial.phone,
    mobile: partial.mobile,
    companyId: partial.companyId,
    isCustomer: partial.isCustomer ?? false,
    isVendor: partial.isVendor ?? false,
    isEmployee: partial.isEmployee ?? false,
    isProspect: partial.isProspect ?? true,
    isPartner: partial.isPartner ?? false,
    customerRank: partial.customerRank ?? 0,
    supplierRank: partial.supplierRank ?? 0,
    displayName: partial.displayName,
    firstName: partial.firstName,
    lastName: partial.lastName,
    title: partial.title,
    emailSecondary: partial.emailSecondary,
    fax: partial.fax,
    website: partial.website,
    street: partial.street,
    street2: partial.street2,
    city: partial.city,
    stateCode: partial.stateCode,
    zip: partial.zip,
    countryCode: partial.countryCode,
    taxId: partial.taxId,
    companyRegistry: partial.companyRegistry,
    industry: partial.industry,
    employeesCount: partial.employeesCount,
    annualRevenue: partial.annualRevenue,
    description: partial.description,
    salespersonId: partial.salespersonId,
    assignedUserId: partial.assignedUserId,
    parentId: partial.parentId,
    userId: partial.userId,
    color: partial.color,
    metadata: partial.metadata,
  }
}

export function finalizeCreateActivityParams(
  partial: Partial<CreateActivityParams>,
): CreateActivityParams {
  if (partial.activityTypeId == null || partial.activityTypeId === 0n) {
    throw new Error("activityTypeId is required to create an activity")
  }
  return {
    activityTypeId: partial.activityTypeId,
    summary: partial.summary ?? "",
    priority: partial.priority ?? "normal",
    state: partial.state ?? "planned",
    auto: partial.auto ?? false,
    isSystem: partial.isSystem ?? false,
    isDone: partial.isDone ?? false,
    note: partial.note,
    dateDeadline: partial.dateDeadline,
    dateDone: partial.dateDone,
    assignedTo: partial.assignedTo,
    // CRM-RI-015: `resModel`/`resId` were replaced by the typed, server-validated
    // `target`. It is passed through unchanged rather than defaulted — an absent
    // target is a legitimate, unattached activity.
    target: partial.target,
    duration: partial.duration,
    location: partial.location,
    videoUrl: partial.videoUrl,
    metadata: partial.metadata,
  }
}

export function finalizeCreateContactTagParams(
  partial: Partial<CreateContactTagParams>,
): CreateContactTagParams {
  return {
    name: partial.name ?? "",
    color: partial.color,
    description: partial.description,
    metadata: partial.metadata,
  }
}

export function finalizeCreateContactCategoryParams(
  partial: Partial<CreateContactCategoryParams>,
): CreateContactCategoryParams {
  return {
    name: partial.name ?? "",
    color: partial.color,
    parentId: partial.parentId,
    isActive: partial.isActive ?? true,
    metadata: partial.metadata,
  }
}

export function finalizeCreateContactSegmentParams(
  partial: Partial<CreateContactSegmentParams>,
): CreateContactSegmentParams {
  return {
    name: partial.name ?? "",
    isDynamic: partial.isDynamic ?? false,
    isActive: partial.isActive ?? true,
    description: partial.description,
    domain: partial.domain,
    color: partial.color,
    parentId: partial.parentId,
    metadata: partial.metadata,
  }
}

/** Strip undefined keys from CRM update patches before `stdbParamsToJson`. */
export function finalizeUpdateContactParams(
  partial: Partial<UpdateContactCoreParams>,
): UpdateContactCoreParams {
  return pickDefined(partial);
}

export function finalizeUpdateOpportunityParams(
  partial: Partial<UpdateOpportunityParams>,
): UpdateOpportunityParams {
  return pickDefined(partial);
}

/**
 * Strip undefined keys from an `update_contact_category` patch before
 * `stdbParamsToJson`. Must be passed WITHOUT a `structName` — `color`,
 * `parentId`, and `metadata` are `Option<Option<T>>` on the reducer (three-
 * state: omit=unchanged, null=clear, value=replace), and forcing a
 * `structName` would fill every absent key with an explicit "none" tag,
 * turning "field not touched" into "clear this field" (the same CRM-RI-003
 * class of bug as {@link finalizeUpdateContactParams}).
 */
export function finalizeUpdateContactCategoryParams(
  partial: Partial<UpdateContactCategoryParams>,
): UpdateContactCategoryParams {
  return pickDefined(partial);
}

/**
 * Params for the `update_contact_address` reducer (CRM-RI-003). Hand-declared
 * rather than imported from `@lumiere/stdb/types` because the backend reducer's
 * fields are now `Option<Option<T>>` (three-state: omit=unchanged, null=clear,
 * value=replace) without a `spacetime generate` pass in this sandbox — replace
 * this with the generated type once bindings are regenerated.
 *
 * Unlike leads (CRM-RI-004), contacts keep three separate reducers
 * (`update_contact_address`/`update_contact_business`/`update_contact_details`)
 * — only the Option-nesting/patch semantics changed here, not the reducer split.
 */
export interface UpdateContactAddressParams {
  street?: string | null
  street2?: string | null
  city?: string | null
  stateCode?: string | null
  zip?: string | null
  countryCode?: string | null
}

/** Params for the `update_contact_business` reducer (CRM-RI-003). See {@link UpdateContactAddressParams} for why this is hand-declared. */
export interface UpdateContactBusinessParams {
  taxId?: string | null
  companyRegistry?: string | null
  industry?: string | null
  employeesCount?: number | null
  annualRevenue?: number | null
}

/** Params for the `update_contact_details` reducer (CRM-RI-003). See {@link UpdateContactAddressParams} for why this is hand-declared. */
export interface UpdateContactDetailsParams {
  firstName?: string | null
  lastName?: string | null
  title?: string | null
  emailSecondary?: string | null
  fax?: string | null
  website?: string | null
  description?: string | null
  color?: string | null
}

/**
 * Strip undefined (untouched) keys from an `update_contact_address` patch
 * before `stdbParamsToJson`. Must be passed to `stdbParamsToJson` WITHOUT a
 * `structName` — passing one would force every `Option` field absent from the
 * object to be filled with an explicit "none" tag, which collapses "unchanged"
 * into "clear" (see CRM-RI-003).
 */
export function finalizeUpdateContactAddressParams(
  partial: Partial<UpdateContactAddressParams>,
): UpdateContactAddressParams {
  return pickDefined(partial);
}

/** See {@link finalizeUpdateContactAddressParams} — same fix, applied to `update_contact_business`. */
export function finalizeUpdateContactBusinessParams(
  partial: Partial<UpdateContactBusinessParams>,
): UpdateContactBusinessParams {
  return pickDefined(partial);
}

/** See {@link finalizeUpdateContactAddressParams} — same fix, applied to `update_contact_details`. */
export function finalizeUpdateContactDetailsParams(
  partial: Partial<UpdateContactDetailsParams>,
): UpdateContactDetailsParams {
  return pickDefined(partial);
}

export function finalizeUpdateLeadDetailsParams(
  partial: Partial<UpdateLeadDetailsParams>,
): UpdateLeadDetailsParams {
  return pickDefined(partial);
}

export function finalizeUpdateLeadAddressParams(
  partial: Partial<UpdateLeadAddressParams>,
): UpdateLeadAddressParams {
  return pickDefined(partial);
}

export function finalizeUpdateLeadRevenueParams(
  partial: Partial<UpdateLeadRevenueParams>,
): UpdateLeadRevenueParams {
  return pickDefined(partial);
}

/**
 * Params for the atomic `update_lead` reducer (CRM-RI-004), covering the union
 * of fields previously split across `update_lead_details`/`update_lead_address`/
 * `update_lead_revenue`. Hand-declared rather than imported from `@lumiere/stdb/types`
 * because the backend reducer was added without a `spacetime generate` pass
 * (blocked by sandbox publish permissions) — replace this with the generated
 * type once bindings are regenerated.
 *
 * Every field maps to a Rust `Option<Option<T>>` (or plain `Option<f64>` for the
 * two revenue fields, which have no "clear" state) — omit a key to leave it
 * unchanged, send `null` to explicitly clear, send a value to replace.
 */
export interface UpdateLeadParams {
  contactName?: string | null
  title?: string | null
  website?: string | null
  industry?: string | null
  referredBy?: string | null
  description?: string | null
  street?: string | null
  city?: string | null
  zip?: string | null
  countryCode?: string | null
  expectedRevenue?: number
  probability?: number
}

/**
 * Strip undefined (untouched) keys from an `update_lead` patch before
 * `stdbParamsToJson`. Unlike the three legacy `finalizeUpdateLead*` functions
 * above, this must be passed to `stdbParamsToJson` WITHOUT a `structName` —
 * passing one would force every `Option` field absent from the object to be
 * filled with an explicit "none" tag, which collapses "unchanged" into
 * "clear" (see CRM-RI-003). See `useUpdateAccountGroup` for the precedent.
 */
export function finalizeUpdateLeadParams(
  partial: Partial<UpdateLeadParams>,
): UpdateLeadParams {
  return pickDefined(partial);
}
