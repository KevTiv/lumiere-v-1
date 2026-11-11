export interface PostHogBrowserConfig {
  token: string
  uiHost: string
}

export function readPostHogProjectToken(): string | undefined {
  const token =
    process.env.POSTHOG_WEB_TOKEN?.trim() || process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim()
  // Only project ingestion tokens are safe to expose to the browser.
  return token && /^phc_[a-z0-9_-]+$/i.test(token) ? token : undefined
}

export function readPostHogBrowserConfig(): PostHogBrowserConfig | undefined {
  const token = readPostHogProjectToken()
  if (!token) return
  const ingestHost =
    process.env.POSTHOG_HOST?.trim() || process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim()
  const uiHost =
    process.env.POSTHOG_UI_HOST?.trim() || process.env.NEXT_PUBLIC_POSTHOG_UI_HOST?.trim()
  return {
    token,
    uiHost:
      uiHost?.replace(/\/$/, "") ||
      (ingestHost?.startsWith("https://us.i.posthog.com")
        ? "https://us.posthog.com"
        : "https://eu.posthog.com"),
  }
}
