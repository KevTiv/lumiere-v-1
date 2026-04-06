/**
 * Maps CRM quick-action form payloads to SpacetimeDB reducer param types.
 */

import type {
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreateActivityParams,
  CreateContactParams,
  CreateLeadParams,
  CreateOpportunityParams,
} from '@lumiere/stdb/generated/types';
import type { Timestamp } from "spacetimedb";

import { stbTimestampFromDate } from "@/lib/stb-timestamp";

import { stdbParamsToJson } from '@/lib/stdb-params-json';

function optionalString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function optionalTrimmedString(v: unknown): string | undefined {
  return optionalString(v);
}

function parseF64(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parses a non-negative stage / id for reducers (form values are often strings). */
function parseU64Field(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v >= 0n ? v : null;
  if (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= 0 &&
    Number.isInteger(v)
  ) {
    return BigInt(v);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    try {
      const b = BigInt(t);
      return b >= 0n ? b : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Lead form uses contact-centric field names; `name` is the lead title required by `create_lead`.
 */
export function toCreateLeadParams(
  formData: Record<string, unknown>,
): CreateLeadParams | null {
  const contactName = optionalTrimmedString(formData.contactName);
  if (!contactName) return null;

  const partnerName = optionalTrimmedString(formData.partnerName);

  return {
    name: contactName,
    priority: 'Medium',
    state: 'new',
    expectedRevenue: parseF64(formData.expectedRevenue, 0),
    probability: parseF64(formData.probability, 0),
    tagIds: [],
    email: optionalTrimmedString(formData.emailFrom),
    phone: optionalTrimmedString(formData.phone),
    mobile: undefined,
    companyName: partnerName,
    contactName,
    title: undefined,
    street: undefined,
    city: undefined,
    zip: undefined,
    countryCode: undefined,
    website: undefined,
    industry: undefined,
    sourceId: undefined,
    campaignId: undefined,
    mediumId: undefined,
    referredBy: undefined,
    description: optionalTrimmedString(formData.description),
    userId: undefined,
    teamId: undefined,
    partnerId: undefined,
    dateDeadline: undefined,
    metadata: undefined,
  };
}

export function toCreateOpportunityParams(
  formData: Record<string, unknown>,
): CreateOpportunityParams | null {
  const name = optionalTrimmedString(formData.name);
  if (!name) return null;

  const stageId = parseU64Field(formData.stageId);
  if (stageId === null) return null;

  const priority = optionalTrimmedString(formData.priority) ?? 'Medium';

  let dateDeadline: CreateOpportunityParams['dateDeadline'];
  const rawDeadline = formData.dateDeadline;
  if (rawDeadline != null && String(rawDeadline).trim() !== '') {
    const d = new Date(String(rawDeadline));
    if (!Number.isNaN(d.getTime())) {
      dateDeadline = stbTimestampFromDate(d);
    }
  }

  return {
    name,
    expectedRevenue: parseF64(formData.expectedRevenue, 0),
    probability: parseF64(formData.probability, 0),
    stageId,
    priority,
    isWon: false,
    isLost: false,
    tagIds: [],
    leadId: undefined,
    partnerId: undefined,
    contactId: undefined,
    campaignId: undefined,
    mediumId: undefined,
    sourceId: undefined,
    userId: undefined,
    teamId: undefined,
    companyId: undefined,
    companyCurrencyId: undefined,
    lostReasonId: undefined,
    dateOpen: undefined,
    dateClosed: undefined,
    dateDeadline,
    dateLastStageUpdate: undefined,
    dayOpen: undefined,
    dayClose: undefined,
    color: undefined,
    description: undefined,
    metadata: undefined,
  };
}

export function toCreateContactParams(
  formData: Record<string, unknown>,
): CreateContactParams | null {
  const name = optionalTrimmedString(formData.name);
  if (!name) return null;

  const isCompany = Boolean(formData.isCompany);

  return {
    name,
    type: isCompany ? 'company' : 'contact',
    email: optionalTrimmedString(formData.email),
    phone: optionalTrimmedString(formData.phone),
    mobile: undefined,
    companyId: undefined,
    isCustomer: !isCompany,
    isVendor: false,
    isEmployee: false,
    isProspect: true,
    isPartner: false,
    customerRank: 0,
    supplierRank: 0,
    displayName: undefined,
    firstName: undefined,
    lastName: undefined,
    title: undefined,
    emailSecondary: undefined,
    fax: undefined,
    website: undefined,
    street: undefined,
    street2: undefined,
    city: optionalTrimmedString(formData.city),
    stateCode: undefined,
    zip: optionalTrimmedString(formData.zip),
    countryCode: undefined,
    taxId: undefined,
    companyRegistry: undefined,
    industry: undefined,
    employeesCount: undefined,
    annualRevenue: undefined,
    description: undefined,
    salespersonId: undefined,
    assignedUserId: undefined,
    parentId: undefined,
    userId: undefined,
    color: undefined,
    metadata: undefined,
  };
}

export function toCreateActivityParams(
  formData: Record<string, unknown>,
): CreateActivityParams | null {
  const summary = optionalTrimmedString(formData.summary);
  if (!summary) return null;

  const typeRaw = formData.activityTypeId;
  const activityTypeNum = Number(typeRaw);
  if (!Number.isFinite(activityTypeNum) || activityTypeNum <= 0) return null;

  const rawDeadline = formData.dateDeadline;
  if (rawDeadline == null || String(rawDeadline).trim() === '') return null;
  const d = new Date(String(rawDeadline));
  if (Number.isNaN(d.getTime())) return null;

  const userRaw = formData.userId;
  let userIdNum: number | null = null;
  if (userRaw != null && String(userRaw).trim() !== '') {
    const n = Number(userRaw);
    if (Number.isFinite(n) && n > 0) userIdNum = n;
  }

  return {
    activityType: 'todo',
    summary,
    priority: 'normal',
    state: 'planned',
    auto: false,
    isSystem: false,
    isDone: false,
    note: optionalTrimmedString(formData.note),
    dateDeadline: stbTimestampFromDate(d),
    dateDone: undefined,
    assignedTo: undefined,
    resModel: undefined,
    resId: undefined,
    duration: undefined,
    location: undefined,
    videoUrl: undefined,
    metadata: JSON.stringify({
      activityTypeId: activityTypeNum,
      userId: userIdNum,
    }),
  };
}

/**
 * Converts reducer params to JSON-serializable plain objects (Timestamps and bigints are not JSON-safe by default).
 */
export function crmParamsToJson(
  params:
    | CreateLeadParams
    | CreateOpportunityParams
    | CreateContactParams
    | CreateActivityParams
    | ConvertLeadParams
    | ConvertOpportunityParams,
): Record<string, unknown> {
  return stdbParamsToJson(params);
}

export function toConvertLeadParams(
  formData: Record<string, unknown>,
): ConvertLeadParams | null {
  const createContact = Boolean(formData.createContact);
  const createOpportunity = Boolean(formData.createOpportunity);
  let opportunityStageId: ConvertLeadParams['opportunityStageId'];
  if (createOpportunity) {
    const sid = parseU64Field(formData.opportunityStageId);
    if (sid === null) return null;
    opportunityStageId = sid;
  } else {
    opportunityStageId = undefined;
  }

  return {
    createContact,
    createOpportunity,
    contactType: undefined,
    isVendor: undefined,
    isEmployee: undefined,
    isProspect: undefined,
    isPartner: undefined,
    customerRank: undefined,
    supplierRank: undefined,
    opportunityStageId,
    metadata: undefined,
  };
}

export function toConvertOpportunityParams(
  formData: Record<string, unknown>,
): ConvertOpportunityParams | null {
  const pricelistId = parseU64Field(formData.pricelistId);
  const warehouseId = parseU64Field(formData.warehouseId);
  if (pricelistId === null || warehouseId === null) return null;
  return { pricelistId, warehouseId };
}
