import posthog from "posthog-js"
import type { PostHogBrowserConfig } from "./posthog-config"
import {
  analyticsDistinctId,
  filterAnalyticsEvent,
  type BrowserAnalyticsEvent,
} from "./posthog-events"

let enabled = false

export function initializeBrowserAnalytics(config: PostHogBrowserConfig | undefined) {
  if (!config || enabled) return
  try {
    posthog.init(config.token, {
      api_host: "/ingest",
      ui_host: config.uiHost,
      person_profiles: "identified_only",
      autocapture: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      before_send: (event) => event && filterAnalyticsEvent(event),
    })
    enabled = true
  } catch {
    // The browser can deny access to analytics storage.
  }
}

export function phCapture(event: BrowserAnalyticsEvent, properties?: Record<string, unknown>) {
  if (!enabled) return
  try {
    posthog.capture(event, properties)
  } catch {
    // Analytics must never affect a product action.
  }
}

export function phIdentifySession(identity?: string | null) {
  const distinctId = analyticsDistinctId(identity)
  if (!enabled) return
  try {
    const previous = posthog.get_property("$user_id")
    if (previous && previous !== distinctId) posthog.reset()
    if (distinctId && posthog.get_distinct_id() !== distinctId) posthog.identify(distinctId)
    return distinctId
  } catch {
    // The browser can deny access to analytics storage.
  }
}

export function captureAssistantIntent(
  event: "assistant_opened" | "assistant_turn_submitted" | "assistant_recovery_clicked",
  identity: string | null | undefined,
  organizationId: number | null | undefined,
  companyId: number | null | undefined,
) {
  if (!phIdentifySession(identity)) return
  phCapture(event, { organization_id: organizationId, company_id: companyId })
}

export function phReset() {
  if (enabled) {
    try {
      posthog.reset()
    } catch {
      // Sign-out continues if analytics storage is unavailable.
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("lumiere:posthog-reset"))
  }
}
