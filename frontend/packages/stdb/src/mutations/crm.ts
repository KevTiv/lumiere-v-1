import { stdbBrowserCommand } from "../browser-http"
import type {
  CreateUtmCampaignParams,
  UpdateUtmCampaignParams,
  CreateUtmMediumParams,
  UpdateUtmMediumParams,
  CreateUtmSourceParams,
  UpdateUtmSourceParams,
} from "../generated/types"
import { stdbParamsToJson } from "../stdb-params-json"

export type {
  CreateUtmCampaignParams,
  UpdateUtmCampaignParams,
  CreateUtmMediumParams,
  UpdateUtmMediumParams,
  CreateUtmSourceParams,
  UpdateUtmSourceParams,
}

// ── UTM (marketing attribution) ──────────────────────────────────────────────

export function createUtmCampaign(_organizationId: bigint, params: CreateUtmCampaignParams) {
  return stdbBrowserCommand("create_utm_campaign", {
    params: stdbParamsToJson(params as object, "CreateUtmCampaignParams"),
  })
}

export function updateUtmCampaign(
  _organizationId: bigint,
  campaignId: bigint,
  params: UpdateUtmCampaignParams,
) {
  return stdbBrowserCommand("update_utm_campaign", {
    campaignId,
    params: stdbParamsToJson(params as object, "UpdateUtmCampaignParams"),
  })
}

export function createUtmMedium(_organizationId: bigint, params: CreateUtmMediumParams) {
  return stdbBrowserCommand("create_utm_medium", {
    params: stdbParamsToJson(params as object, "CreateUtmMediumParams"),
  })
}

export function updateUtmMedium(
  _organizationId: bigint,
  mediumId: bigint,
  params: UpdateUtmMediumParams,
) {
  return stdbBrowserCommand("update_utm_medium", {
    mediumId,
    params: stdbParamsToJson(params as object, "UpdateUtmMediumParams"),
  })
}

export function createUtmSource(_organizationId: bigint, params: CreateUtmSourceParams) {
  return stdbBrowserCommand("create_utm_source", {
    params: stdbParamsToJson(params as object, "CreateUtmSourceParams"),
  })
}

export function updateUtmSource(
  _organizationId: bigint,
  sourceId: bigint,
  params: UpdateUtmSourceParams,
) {
  return stdbBrowserCommand("update_utm_source", {
    sourceId,
    params: stdbParamsToJson(params as object, "UpdateUtmSourceParams"),
  })
}

// ── Chatter / followers ──────────────────────────────────────────────────────

export function postInternalNote(
  _organizationId: bigint,
  model: string,
  resId: bigint,
  body: string,
) {
  return stdbBrowserCommand("post_internal_note", { model, resId, body })
}

export function subscribeToRecord(
  _organizationId: bigint,
  resModel: string,
  resId: bigint,
  subtypes: string[],
) {
  return stdbBrowserCommand("subscribe_to_record", { resModel, resId, subtypes })
}

export function unsubscribeFromRecord(_organizationId: bigint, resModel: string, resId: bigint) {
  return stdbBrowserCommand("unsubscribe_from_record", { resModel, resId })
}
