import posthog from "posthog-js"

const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN
if (typeof token === "string" && token.length > 0) {
  /** In-app PostHog UI (session replay links, toolbar), not the ingestion API host. */
  const uiHost =
    process.env.NEXT_PUBLIC_POSTHOG_UI_HOST?.replace(/\/$/, "") ?? "https://eu.posthog.com"

  posthog.init(token, {
    api_host: "/ingest",
    ui_host: uiHost,
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  })
}
