/**
 * Maps CRM edit / lifecycle form payloads to UpdateOpportunityParams.
 */

import type {
  UpdateContactAddressParams,
  UpdateContactBusinessParams,
  UpdateContactDetailsParams,
  UpdateContactCoreParams,
  UpdateLeadAddressParams,
  UpdateLeadDetailsParams,
  UpdateLeadRevenueParams,
  UpdateOpportunityParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function parseF64(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

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

/** Convert SpacetimeDB timestamp (or wire value) to `<input type="date">` value. */
export function timestampToDateInputValue(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object" && "microsSinceUnixEpoch" in v) {
    const micros = BigInt(String((v as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch))
    return new Date(Number(micros / 1000n)).toISOString().slice(0, 10)
  }
  if (typeof v === "number" || typeof v === "bigint") {
    const micros = typeof v === "bigint" ? v : BigInt(Math.trunc(v))
    return new Date(Number(micros / 1000n)).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (s === "") return ""
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

export function toUpdateOpportunityStageParams(
  formData: Record<string, unknown>,
): Partial<UpdateOpportunityParams> | null {
  const stageId = parseU64Field(formData.stageId)
  if (stageId === null) return null
  return { stageId }
}

export function toUpdateOpportunityParams(
  formData: Record<string, unknown>,
): Partial<UpdateOpportunityParams> | null {
  const out: Partial<UpdateOpportunityParams> = {}

  const expectedRevenueRaw = formData.expectedRevenue
  if (expectedRevenueRaw != null && String(expectedRevenueRaw).trim() !== "") {
    out.expectedRevenue = parseF64(expectedRevenueRaw, 0)
  }

  const stageId = parseU64Field(formData.stageId)
  if (stageId !== null) out.stageId = stageId

  const partnerRaw = formData.partnerId
  if (partnerRaw != null && String(partnerRaw).trim() !== "") {
    const partnerId = parseU64Field(partnerRaw)
    if (partnerId !== null) out.partnerId = partnerId
  }

  const description = optionalTrimmedString(formData.description)
  if (description !== undefined) out.description = description

  const dateDeadline = optionalDateDeadlineFromForm(formData.dateDeadline)
  if (dateDeadline !== undefined) out.dateDeadline = dateDeadline

  return Object.keys(out).length > 0 ? out : null
}

function patchFromForm(
  formData: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of fields) {
    if (!(key in formData)) continue
    const raw = formData[key]
    if (raw === "" || raw == null) continue
    if (typeof raw === "boolean") {
      out[key] = raw
      continue
    }
    if (key === "employeesCount") {
      const n = Number(raw)
      if (Number.isFinite(n)) out[key] = Math.trunc(n)
      continue
    }
    if (key === "expectedRevenue" || key === "probability" || key === "annualRevenue") {
      const n = Number(raw)
      if (Number.isFinite(n)) out[key] = n
      continue
    }
    const s = optionalTrimmedString(raw)
    if (s !== undefined) out[key] = s
  }
  return out
}

export function toUpdateContactParams(
  formData: Record<string, unknown>,
): Partial<UpdateContactCoreParams> | null {
  const out = patchFromForm(formData, [
    "name",
    "email",
    "phone",
    "mobile",
    "isCustomer",
    "isVendor",
    "isProspect",
    "isPartner",
  ]) as Partial<UpdateContactCoreParams>
  return Object.keys(out).length > 0 ? out : null
}

export function toUpdateContactAddressParams(
  formData: Record<string, unknown>,
): Partial<UpdateContactAddressParams> | null {
  const out = patchFromForm(formData, [
    "street",
    "street2",
    "city",
    "stateCode",
    "zip",
    "countryCode",
  ]) as Partial<UpdateContactAddressParams>
  return Object.keys(out).length > 0 ? out : null
}

export function toUpdateContactBusinessParams(
  formData: Record<string, unknown>,
): Partial<UpdateContactBusinessParams> | null {
  const out = patchFromForm(formData, [
    "taxId",
    "companyRegistry",
    "industry",
    "employeesCount",
    "annualRevenue",
  ]) as Partial<UpdateContactBusinessParams>
  return Object.keys(out).length > 0 ? out : null
}

export function toUpdateContactDetailsParams(
  formData: Record<string, unknown>,
): Partial<UpdateContactDetailsParams> | null {
  const out = patchFromForm(formData, [
    "firstName",
    "lastName",
    "title",
    "emailSecondary",
    "fax",
    "website",
    "description",
    "color",
  ]) as Partial<UpdateContactDetailsParams>
  return Object.keys(out).length > 0 ? out : null
}

export function toUpdateLeadDetailsParams(
  formData: Record<string, unknown>,
): Partial<UpdateLeadDetailsParams> | null {
  const out = patchFromForm(formData, [
    "contactName",
    "title",
    "website",
    "industry",
    "referredBy",
    "description",
  ]) as Partial<UpdateLeadDetailsParams>
  return Object.keys(out).length > 0 ? out : null
}

export function toUpdateLeadAddressParams(
  formData: Record<string, unknown>,
): Partial<UpdateLeadAddressParams> | null {
  const out = patchFromForm(formData, [
    "street",
    "city",
    "zip",
    "countryCode",
  ]) as Partial<UpdateLeadAddressParams>
  return Object.keys(out).length > 0 ? out : null
}

export function toUpdateLeadRevenueParams(
  formData: Record<string, unknown>,
): Partial<UpdateLeadRevenueParams> | null {
  const expectedRevenue = Number(formData.expectedRevenue ?? 0)
  const probability = Number(formData.probability ?? 0)
  if (!Number.isFinite(expectedRevenue) || !Number.isFinite(probability)) return null
  return { expectedRevenue, probability }
}

export function toCreateContactTagParamsFromForm(
  formData: Record<string, unknown>,
): { name: string; color?: string; description?: string } | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null
  return {
    name,
    color: optionalTrimmedString(formData.color),
    description: optionalTrimmedString(formData.description),
  }
}

export function toCreateContactSegmentParamsFromForm(formData: Record<string, unknown>): {
  name: string
  isDynamic: boolean
  isActive: boolean
  description?: string
  domain?: string
} | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null
  return {
    name,
    isDynamic: Boolean(formData.isDynamic),
    isActive: formData.isActive !== false,
    description: optionalTrimmedString(formData.description),
    domain: optionalTrimmedString(formData.domain),
  }
}
