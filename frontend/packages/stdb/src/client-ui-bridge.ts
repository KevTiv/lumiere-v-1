/**
 * Minimal client surface for `@lumiere/ui` during the API gateway refactor (Phase 4–5).
 * Avoids importing the `@lumiere/stdb` main barrel (hooks + queries) into shared UI.
 */
"use client"

export * from "./mutations/form-config"
export {
  createUtmCampaign,
  updateUtmCampaign,
  createUtmMedium,
  updateUtmMedium,
  createUtmSource,
  updateUtmSource,
  postInternalNote,
  subscribeToRecord,
  unsubscribeFromRecord,
} from "./mutations/crm"
