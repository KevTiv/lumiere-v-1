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
  CreateUtmCampaignParams,
  CreateUtmMediumParams,
  CreateUtmSourceParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { nullableBigIntU64, optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

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
    metadata: optionalTrimmedString(formData.metadata),
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
    metadata: optionalTrimmedString(formData.metadata),
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
    metadata: optionalTrimmedString(formData.metadata),
  }
}

/** Defaults (activityType, priority, state, flags) merged in `useCreateActivity`. */
const ACTIVITY_TYPE_VALUES = new Set(["call", "email", "meeting", "todo"])

function resolveActivityType(formData: Record<string, unknown>): string | null {
  const raw = formData.activityType ?? formData.activityTypeId
  const s = String(raw ?? "").trim().toLowerCase()
  if (ACTIVITY_TYPE_VALUES.has(s)) return s
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return "todo"
  return null
}

export function toCreateActivityParams(formData: Record<string, unknown>): Partial<CreateActivityParams> | null {
  const summary = optionalTrimmedString(formData.summary)
  if (!summary) return null

  const activityType = resolveActivityType(formData)
  if (!activityType) return null

  const rawDeadline = formData.dateDeadline
  if (rawDeadline == null || String(rawDeadline).trim() === "") return null
  const d = new Date(String(rawDeadline))
  if (Number.isNaN(d.getTime())) return null

  const resModel = optionalTrimmedString(formData.resModel)
  const resIdRaw = formData.resId
  const resIdNum =
    resIdRaw != null && String(resIdRaw).trim() !== "" && Number.isFinite(Number(resIdRaw)) && Number(resIdRaw) > 0
      ? BigInt(String(resIdRaw))
      : undefined

  return {
    activityType,
    summary,
    note: optionalTrimmedString(formData.note),
    dateDeadline: stbTimestampFromDate(d),
    resModel: resModel ?? undefined,
    resId: resIdNum,
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

  const companyId = parseU64Field(formData.companyId) ?? undefined

  return {
    createContact,
    createOpportunity,
    companyId,
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

function parseTaxIdList(raw: unknown): bigint[] {
  if (raw == null || String(raw).trim() === "") return []
  return String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => BigInt(p))
}

export function toCreateOpportunityLineParams(
  formData: Record<string, unknown>,
): import("@lumiere/stdb/types").CreateOpportunityLineParams | null {
  const productId = nullableBigIntU64(formData.productId)
  const uomId = nullableBigIntU64(formData.uomId)
  const quantity = Number(formData.quantity)
  const priceUnit = Number(formData.priceUnit)
  if (
    productId == null ||
    uomId == null ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(priceUnit) ||
    priceUnit < 0
  ) {
    return null
  }

  const discountRaw = formData.discount
  const discount =
    discountRaw === "" || discountRaw == null ? 0 : Number(discountRaw)
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) return null

  const sequenceRaw = formData.sequence
  const sequence =
    sequenceRaw === "" || sequenceRaw == null
      ? 10
      : Math.trunc(Number(sequenceRaw))

  return {
    productId,
    name: optionalTrimmedString(formData.name),
    quantity,
    uomId,
    priceUnit,
    discount,
    taxIds: parseTaxIdList(formData.taxIds),
    sequence,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateUtmCampaignParams(
  name: string,
  isActive = true,
): CreateUtmCampaignParams {
  return { name: name.trim(), isActive }
}

export function toCreateUtmMediumParams(name: string, isActive = true): CreateUtmMediumParams {
  return { name: name.trim(), isActive }
}

export function toCreateUtmSourceParams(name: string, isActive = true): CreateUtmSourceParams {
  return { name: name.trim(), isActive }
}
