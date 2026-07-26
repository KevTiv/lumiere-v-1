import type {
  CreateHelpdeskSlaParams,
  CreateHelpdeskStageParams,
  CreateHelpdeskTeamParams,
  CreateTicketParams,
  UpdateTicketParams,
} from "@lumiere/stdb/types"

import { pickDefined } from "./params-merge-utils"

const defaultTicketPriority: CreateTicketParams["priority"] = { tag: "Normal" }

/** Merge partial Helpdesk create payloads with hook defaults before `stdbParamsToJson`. */
export function finalizeCreateTicketParams(
  partial: Partial<CreateTicketParams>,
): CreateTicketParams {
  if (partial.teamId == null || partial.teamId === 0n) {
    throw new Error("teamId is required to create a ticket")
  }
  if (partial.stageId == null || partial.stageId === 0n) {
    throw new Error("stageId is required to create a ticket")
  }
  return {
    teamId: partial.teamId,
    stageId: partial.stageId,
    name: partial.name ?? "",
    description: partial.description,
    priority: partial.priority ?? defaultTicketPriority,
    partnerId: partial.partnerId,
    partnerName: partial.partnerName,
    partnerEmail: partial.partnerEmail,
    slaId: partial.slaId,
    slaDeadline: partial.slaDeadline,
  }
}

export function finalizeCreateHelpdeskTeamParams(
  partial: Partial<CreateHelpdeskTeamParams>,
): CreateHelpdeskTeamParams {
  return {
    name: partial.name ?? "",
    description: partial.description,
    isActive: partial.isActive ?? true,
  }
}

export function finalizeCreateHelpdeskStageParams(
  partial: Partial<CreateHelpdeskStageParams>,
): CreateHelpdeskStageParams {
  return {
    name: partial.name ?? "",
    teamId: partial.teamId,
    sequence: partial.sequence ?? 0,
    isClosed: partial.isClosed ?? false,
    description: partial.description,
    template: partial.template,
  }
}

export function finalizeCreateHelpdeskSlaParams(
  partial: Partial<CreateHelpdeskSlaParams>,
): CreateHelpdeskSlaParams {
  if (partial.teamId == null || partial.teamId === 0n) {
    throw new Error("teamId is required to create a helpdesk SLA")
  }
  if (partial.stageId == null || partial.stageId === 0n) {
    throw new Error("stageId is required to create a helpdesk SLA")
  }
  return {
    name: partial.name ?? "",
    teamId: partial.teamId,
    stageId: partial.stageId,
    priority: partial.priority ?? defaultTicketPriority,
    timeDays: partial.timeDays ?? 0,
    timeHours: partial.timeHours ?? 0,
    isActive: partial.isActive ?? true,
  }
}

/** Strip undefined keys from Helpdesk update patches before `stdbParamsToJson`. */
export function finalizeUpdateTicketParams(
  partial: Partial<UpdateTicketParams>,
): UpdateTicketParams {
  return pickDefined(partial)
}
