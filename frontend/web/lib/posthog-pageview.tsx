"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { initializeBrowserAnalytics, phCapture, phIdentifySession } from "./posthog-browser"
import { analyticsPage } from "./posthog-events"
import type { PostHogBrowserConfig } from "./posthog-config"

export function PostHogPageView({
  identity,
  config,
}: {
  identity?: string
  config?: PostHogBrowserConfig
}) {
  const pathname = usePathname()

  useEffect(() => {
    if (!config) return
    initializeBrowserAnalytics(config)
    phIdentifySession(identity)
    if (pathname) phCapture("$pageview", { $pathname: analyticsPage(pathname) })
  }, [config, identity, pathname])

  return null
}
