/**
 * Maps Helpdesk form payloads to reducer param bodies (hooks merge defaults + JSON).
 */

import type {
  CreateHelpdeskSlaParams,
  CreateHelpdeskStageParams,
  CreateHelpdeskTeamParams,
  CreateTicketParams,
} from "@lumiere/stdb/types"

import { optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

function parseU64Field(v: unknown): bigint | null {
  if (typeof v === "bigint") return v >= 0n ? v : null
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0) {
    return BigInt(v)
  }
  if (typeof v === "string") {
    const s = v.trim()
    if (s === "") return null
    try {
      const b = BigInt(s)
      return b >= 0n ? b : null
    } catch {
      return null
    }
  }
  return null
}

function parseU32Field(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback
}

function toTicketPriority(v: unknown): CreateTicketParams["priority"] {
  const raw = (optionalTrimmedString(v) ?? "normal").toLowerCase()
  if (raw === "low") return { tag: "Low" }
  if (raw === "high") return { tag: "High" }
  if (raw === "urgent") return { tag: "Urgent" }
  return { tag: "Normal" }
}

export function toCreateTicketParams(formData: Record<string, unknown>): Partial<CreateTicketParams> | null {
  const teamId = parseU64Field(formData.teamId)
  const stageId = parseU64Field(formData.stageId)
  if (teamId === null || stageId === null) return null

  const name = optionalTrimmedString(formData.name)
  if (!name) return null

  return {
    teamId,
    stageId,
    name,
    description: optionalTrimmedString(formData.description),
    priority: toTicketPriority(formData.priority),
    partnerId: parseU64Field(formData.partnerId) ?? undefined,
    partnerName: optionalTrimmedString(formData.partnerName),
    partnerEmail: optionalTrimmedString(formData.partnerEmail),
    slaId: parseU64Field(formData.slaId) ?? undefined,
  }
}

export function toCreateHelpdeskTeamParams(
  formData: Record<string, unknown>,
): Partial<CreateHelpdeskTeamParams> | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null

  return {
    name,
    description: optionalTrimmedString(formData.description),
    isActive: Boolean(formData.isActive ?? true),
  }
}

export function toCreateHelpdeskStageParams(
  formData: Record<string, unknown>,
): Partial<CreateHelpdeskStageParams> | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null

  return {
    name,
    teamId: parseU64Field(formData.teamId) ?? undefined,
    sequence: parseU32Field(formData.sequence, 0),
    isClosed: Boolean(formData.isClosed),
    description: optionalTrimmedString(formData.description),
    template: optionalTrimmedString(formData.template),
  }
}

export function toCreateHelpdeskSlaParams(
  formData: Record<string, unknown>,
): Partial<CreateHelpdeskSlaParams> | null {
  const name = optionalTrimmedString(formData.name)
  const teamId = parseU64Field(formData.teamId)
  const stageId = parseU64Field(formData.stageId)
  if (!name || teamId === null || stageId === null) return null

  return {
    name,
    teamId,
    stageId,
    priority: toTicketPriority(formData.priority),
    timeDays: parseU32Field(formData.timeDays, 0),
    timeHours: parseU32Field(formData.timeHours, 0),
    isActive: Boolean(formData.isActive ?? true),
  }
}
