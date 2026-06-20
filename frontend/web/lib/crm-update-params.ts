/**
 * Maps CRM edit / lifecycle form payloads to UpdateOpportunityParams.
 */

import type { UpdateOpportunityParams } from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

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
