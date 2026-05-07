import { PostHog } from "posthog-node"

/** Prefer server-only `POSTHOG_KEY`; falls back to the public project key when unset. */
function projectApiKey(): string | undefined {
  const k =
    process.env.POSTHOG_KEY ||
    process.env.POSTHOG_API_KEY ||
    process.env.NEXT_PUBLIC_POSTHOG_TOKEN
  return typeof k === "string" && k.length > 0 ? k : undefined
}

function ingestHost(): string {
  const h =
    process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com"
  return h.replace(/\/$/, "")
}

let singleton: PostHog | null | undefined

/**
 * Singleton PostHog Node client. Returns `null` if no API key is configured.
 */
export function getPostHogClient(): PostHog | null {
  const key = projectApiKey()
  if (!key) return null
  if (singleton === undefined) {
    singleton = new PostHog(key, {
      host: ingestHost(),
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return singleton
}

/**
 * Capture a server-side event and wait for it to flush (safe for serverless / route handlers).
 */
export async function captureServerEvent(args: {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}): Promise<void> {
  const ph = getPostHogClient()
  if (!ph) return
  ph.capture({
    distinctId: args.distinctId,
    event: args.event,
    properties: args.properties,
  })
  await ph.flush()
}
