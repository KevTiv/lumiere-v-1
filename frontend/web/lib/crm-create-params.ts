/**
 * Maps CRM quick-action form payloads to reducer param bodies (hooks merge defaults + JSON).
 */

import type {
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreateActivityParams,
  CreateContactParams,
  CreateLeadParams,
  CreateOpportunityParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function optionalTrimmedString(v: unknown): string | undefined {
  return optionalString(v)
}

function parseF64(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Parses a non-negative stage / id for reducers (form values are often strings). */
function parseU64Field(v: unknown): bigint | null {
  if (typeof v === "bigint") return v >= 0n ? v : null
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v)) {
    return BigInt(v)
  }
  if (typeof v === "string") {
    const t = v.trim()
    if (t === "") return null
    try {
      const b = BigInt(t)
      return b >= 0n ? b : null
    } catch {
      return null
    }
  }
  return null
}

function optionalDateDeadlineFromForm(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
}

/**
 * Lead form uses contact-centric field names; `name` is the lead title required by `create_lead`.
 * Defaults (priority, state, tagIds) are applied in `useCreateLead`.
 */
export function toCreateLeadParams(formData: Record<string, unknown>): Partial<CreateLeadParams> | null {
  const contactName = optionalTrimmedString(formData.contactName)
  if (!contactName) return null

  const partnerName = optionalTrimmedString(formData.partnerName)

  const stateRaw = optionalTrimmedString(formData.state)

  return {
    name: contactName,
    expectedRevenue: parseF64(formData.expectedRevenue, 0),
    probability: parseF64(formData.probability, 0),
    state: stateRaw,
    email: optionalTrimmedString(formData.emailFrom),
    phone: optionalTrimmedString(formData.phone),
    companyName: partnerName,
    contactName,
    description: optionalTrimmedString(formData.description),
  }
}

/** Defaults (isWon, isLost, tagIds, companyId) merged in `useCreateOpportunity`. */
export function toCreateOpportunityParams(formData: Record<string, unknown>): Partial<CreateOpportunityParams> | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null

  const stageId = parseU64Field(formData.stageId)
  if (stageId === null) return null

  const priority = optionalTrimmedString(formData.priority) ?? "Medium"

  const rawDeadline = formData.dateDeadline
  const dateDeadline = optionalDateDeadlineFromForm(rawDeadline)

  const out: Partial<CreateOpportunityParams> = {
    name,
    expectedRevenue: parseF64(formData.expectedRevenue, 0),
    probability: parseF64(formData.probability, 0),
    stageId,
    priority,
    dateDeadline,
    color: optionalTrimmedString(formData.color),
    description: optionalTrimmedString(formData.description),
  }
  return out
}

/** Defaults (flags, ranks) merged in `useCreateContact`. */
export function toCreateContactParams(formData: Record<string, unknown>): Partial<CreateContactParams> | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null

  const isCompany = Boolean(formData.isCompany)

  return {
    name,
    type: isCompany ? "company" : "contact",
    email: optionalTrimmedString(formData.email),
    phone: optionalTrimmedString(formData.phone),
    isCustomer: !isCompany,
    city: optionalTrimmedString(formData.city),
    zip: optionalTrimmedString(formData.zip),
    color: optionalTrimmedString(formData.color),
    description: optionalTrimmedString(formData.description),
  }
}

/** Defaults (activityType, priority, state, flags) merged in `useCreateActivity`. */
export function toCreateActivityParams(formData: Record<string, unknown>): Partial<CreateActivityParams> | null {
  const summary = optionalTrimmedString(formData.summary)
  if (!summary) return null

  const typeRaw = formData.activityTypeId
  const activityTypeNum = Number(typeRaw)
  if (!Number.isFinite(activityTypeNum) || activityTypeNum <= 0) return null

  const rawDeadline = formData.dateDeadline
  if (rawDeadline == null || String(rawDeadline).trim() === "") return null
  const d = new Date(String(rawDeadline))
  if (Number.isNaN(d.getTime())) return null

  const userRaw = formData.userId
  const userIdNum =
    userRaw != null && String(userRaw).trim() !== "" && Number.isFinite(Number(userRaw)) && Number(userRaw) > 0
      ? Number(userRaw)
      : null

  return {
    summary,
    note: optionalTrimmedString(formData.note),
    dateDeadline: stbTimestampFromDate(d),
    metadata: JSON.stringify({
      activityTypeId: activityTypeNum,
      userId: userIdNum,
    }),
  }
}

export function toConvertLeadParams(formData: Record<string, unknown>): ConvertLeadParams | null {
  const createContact = Boolean(formData.createContact)
  const createOpportunity = Boolean(formData.createOpportunity)
  let opportunityStageId: ConvertLeadParams["opportunityStageId"]
  if (createOpportunity) {
    const sid = parseU64Field(formData.opportunityStageId)
    if (sid === null) return null
    opportunityStageId = sid
  } else {
    opportunityStageId = undefined
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
  }
}

export function toConvertOpportunityParams(formData: Record<string, unknown>): ConvertOpportunityParams | null {
  const pricelistId = parseU64Field(formData.pricelistId)
  const warehouseId = parseU64Field(formData.warehouseId)
  if (pricelistId === null || warehouseId === null) return null
  return { pricelistId, warehouseId }
}
