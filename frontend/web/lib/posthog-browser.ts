/**
 * Browser-side PostHog helpers. Safe when `NEXT_PUBLIC_POSTHOG_TOKEN` is unset (local dev).
 * Initialization lives in `instrumentation-client.ts`.
 */

import posthog from "posthog-js"

const enabled =
  typeof process.env.NEXT_PUBLIC_POSTHOG_TOKEN === "string" &&
  process.env.NEXT_PUBLIC_POSTHOG_TOKEN.length > 0

export function phCapture(event: string, properties?: Record<string, unknown>) {
  if (!enabled) return
  posthog.capture(event, properties)
}

export function phIdentify(distinctId: string, properties?: Record<string, unknown>) {
  if (!enabled) return
  posthog.identify(distinctId, properties)
}

export function phCaptureException(error: unknown) {
  if (!enabled) return
  posthog.captureException(error)
}

export function phReset() {
  if (!enabled) return
  posthog.reset()
}
