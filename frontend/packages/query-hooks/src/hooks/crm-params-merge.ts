import type {
  CreateActivityParams,
  CreateContactParams,
  CreateContactSegmentParams,
  CreateContactTagParams,
  CreateLeadParams,
  CreateOpportunityParams,
  UpdateContactAddressParams,
  UpdateContactBusinessParams,
  UpdateContactDetailsParams,
  UpdateContactParams,
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
    teamId: partial.teamId,
    partnerId: partial.partnerId,
    dateDeadline: partial.dateDeadline,
    metadata: partial.metadata,
  }
}

export function finalizeCreateOpportunityParams(
  partial: Partial<CreateOpportunityParams>,
): CreateOpportunityParams {
  return {
    name: partial.name ?? "",
    expectedRevenue: partial.expectedRevenue ?? 0,
    probability: partial.probability ?? 0,
    stageId: partial.stageId ?? 0n,
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
  return {
    activityType: partial.activityType ?? "todo",
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
    resModel: partial.resModel,
    resId: partial.resId,
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
  partial: Partial<UpdateContactParams>,
): UpdateContactParams {
  return pickDefined(partial);
}

export function finalizeUpdateOpportunityParams(
  partial: Partial<UpdateOpportunityParams>,
): UpdateOpportunityParams {
  return pickDefined(partial);
}

export function finalizeUpdateContactAddressParams(
  partial: Partial<UpdateContactAddressParams>,
): UpdateContactAddressParams {
  return pickDefined(partial);
}

export function finalizeUpdateContactBusinessParams(
  partial: Partial<UpdateContactBusinessParams>,
): UpdateContactBusinessParams {
  return pickDefined(partial);
}

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
