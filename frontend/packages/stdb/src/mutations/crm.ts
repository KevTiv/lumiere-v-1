import { stdbBrowserCall } from "../browser-http"
import type {
  CreateUtmCampaignParams,
  UpdateUtmCampaignParams,
  CreateUtmMediumParams,
  UpdateUtmMediumParams,
  CreateUtmSourceParams,
  UpdateUtmSourceParams,
} from "../generated/types"

export type {
  CreateUtmCampaignParams,
  UpdateUtmCampaignParams,
  CreateUtmMediumParams,
  UpdateUtmMediumParams,
  CreateUtmSourceParams,
  UpdateUtmSourceParams,
}

// ── UTM (marketing attribution) ──────────────────────────────────────────────

export function createUtmCampaign(organizationId: bigint, params: CreateUtmCampaignParams) {
  return stdbBrowserCall("create_utm_campaign", [organizationId.toString(), params])
}

export function updateUtmCampaign(
  organizationId: bigint,
  campaignId: bigint,
  params: UpdateUtmCampaignParams,
) {
  return stdbBrowserCall("update_utm_campaign", [
    organizationId.toString(),
    campaignId.toString(),
    params,
  ])
}

export function createUtmMedium(organizationId: bigint, params: CreateUtmMediumParams) {
  return stdbBrowserCall("create_utm_medium", [organizationId.toString(), params])
}

export function updateUtmMedium(
  organizationId: bigint,
  mediumId: bigint,
  params: UpdateUtmMediumParams,
) {
  return stdbBrowserCall("update_utm_medium", [
    organizationId.toString(),
    mediumId.toString(),
    params,
  ])
}

export function createUtmSource(organizationId: bigint, params: CreateUtmSourceParams) {
  return stdbBrowserCall("create_utm_source", [organizationId.toString(), params])
}

export function updateUtmSource(
  organizationId: bigint,
  sourceId: bigint,
  params: UpdateUtmSourceParams,
) {
  return stdbBrowserCall("update_utm_source", [
    organizationId.toString(),
    sourceId.toString(),
    params,
  ])
}

// ── Chatter / followers ──────────────────────────────────────────────────────

export function postInternalNote(
  organizationId: bigint,
  model: string,
  resId: bigint,
  body: string,
) {
  return stdbBrowserCall("post_internal_note", [
    organizationId.toString(),
    model,
    resId.toString(),
    body,
  ])
}

export function subscribeToRecord(
  organizationId: bigint,
  resModel: string,
  resId: bigint,
  subtypes: string[],
) {
  return stdbBrowserCall("subscribe_to_record", [
    organizationId.toString(),
    resModel,
    resId.toString(),
    subtypes,
  ])
}

export function unsubscribeFromRecord(organizationId: bigint, resModel: string, resId: bigint) {
  return stdbBrowserCall("unsubscribe_from_record", [
    organizationId.toString(),
    resModel,
    resId.toString(),
  ])
}
