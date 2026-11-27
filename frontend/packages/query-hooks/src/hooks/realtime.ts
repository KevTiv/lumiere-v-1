"use client"

/**
 * Browser WebSocket to api-server `/v1/realtime/ws` (JSON `change` / `subscribed` / `error`).
 *
 * URL resolution:
 * - `NEXT_PUBLIC_REALTIME_WS_URL` — full `ws://` / `wss://` URL (production-friendly).
 * - Else `NEXT_PUBLIC_API_GATEWAY_URL` — direct api-server base (e.g. `http://localhost:8082`).
 * - Else plain Next dev (`localhost:3000`) uses local api-server default.
 * - Else same-origin Kong/reverse-proxy: `ws(s)://{window.location.host}/v1/realtime/ws`.
 */

import type { QueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { invalidateStdbQueryResources } from "./stdb"

/** Authorized API work subscriptions emit invalidations only, without adding private tables to the browser row cache. */
export const API_REALTIME_WORK_RESOURCES = [
  "workflow-human-tasks",
  "workflow-candidate-group-members",
  "workflow-delegations",
] as const

export function withAuthorizedWorkRealtimeResources(
  resources: readonly string[],
  canReadWork: boolean,
): readonly string[] {
  return canReadWork
    ? [...new Set([...resources, ...API_REALTIME_WORK_RESOURCES])]
    : resources
}

export type RealtimeAuthorityState = {
  generation: number
  phase: "connecting" | "subscribed" | "reconnecting"
}

/** Client-only lifecycle signal; it contains no authority or record payload. */
export function realtimeAuthorityKey(
  organizationId: number,
  companyId: number,
  actorIdentity: string,
) {
  return [
    "realtime-authority",
    String(organizationId),
    String(companyId),
    actorIdentity,
  ] as const
}

function httpBaseToRealtimeWsUrl(baseHttp: string): string {
  const u = new URL(baseHttp.replace(/\/$/, ""))
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:"
  return `${wsProto}//${u.host}/v1/realtime/ws`
}

export function resolveRealtimeWsUrl(sameOrigin = false): string {
  if (sameOrigin) {
    if (typeof window === "undefined") return ""
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${window.location.host}/v1/realtime/ws`
  }
  const explicit = process.env.NEXT_PUBLIC_REALTIME_WS_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/$/, "")
  }
  const gateway = process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()
  if (gateway) {
    return httpBaseToRealtimeWsUrl(gateway)
  }
  if (typeof window === "undefined") {
    return ""
  }
  const host = window.location.hostname
  const port = window.location.port
  if ((host === "localhost" || host === "127.0.0.1") && port === "3000") {
    return "ws://127.0.0.1:8082/v1/realtime/ws"
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/v1/realtime/ws`
}

type RealtimeConnectionOptions = {
  organizationId: number
  activeCompanyId: number
  resources: readonly string[]
  url: string
  beforeConnect?: (signal: AbortSignal) => Promise<void>
  onPhase: (phase: RealtimeAuthorityState["phase"], advance?: boolean) => void
  onResources: (resources: readonly string[], recovery?: boolean) => void
  recoverOnSubscribe?: boolean
}

const SUBSCRIPTION_TIMEOUT_MS = 20_000
const STABLE_SUBSCRIPTION_MS = 30_000

/** Own one connection and its retries for a single actor and company scope. */
export function startRealtimeConnection({
  organizationId,
  activeCompanyId,
  resources,
  url,
  beforeConnect,
  onPhase,
  onResources,
  recoverOnSubscribe = false,
}: RealtimeConnectionOptions) {
  let closed = false
  let failures = 0
  let needsRecovery = recoverOnSubscribe
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let disposeAttempt: (() => void) | undefined
  const requestedResources = new Set(resources)

  const connect = async () => {
    if (closed) return

    const controller = new AbortController()
    let socket: WebSocket | undefined
    let subscribed = false
    let stableTimer: ReturnType<typeof setTimeout> | undefined
    const timeout = setTimeout(fail, SUBSCRIPTION_TIMEOUT_MS)

    function dispose() {
      controller.abort()
      clearTimeout(timeout)
      clearTimeout(stableTimer)
      socket?.close()
    }

    function fail() {
      if (closed || controller.signal.aborted) return
      dispose()
      needsRecovery = true
      onPhase("reconnecting", subscribed)
      failures += 1
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))
      retryTimer = setTimeout(connect, delay)
    }

    disposeAttempt = () => {
      const lostSubscription = !controller.signal.aborted && subscribed
      dispose()
      onPhase("reconnecting", lostSubscription)
    }

    try {
      await beforeConnect?.(controller.signal)
      if (controller.signal.aborted) return
      socket = new WebSocket(url)
    } catch {
      fail()
      return
    }

    const connection = socket
    connection.onopen = () => {
      if (controller.signal.aborted) return
      try {
        connection.send(JSON.stringify({
          resources,
          organizationId,
          companyIds: [activeCompanyId],
          activeCompanyId,
        }))
      } catch {
        fail()
      }
    }
    connection.onmessage = (event) => {
      if (controller.signal.aborted || typeof event.data !== "string") return
      let message: { type?: unknown; resources?: unknown; terminal?: unknown } | null
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message?.type === "error") {
        if (!subscribed || message.terminal === true) fail()
        return
      }
      const confirmedResources = Array.isArray(message?.resources)
        ? message.resources.filter((resource): resource is string =>
            typeof resource === "string" && requestedResources.has(resource))
        : []
      if (message?.type === "subscribed" && !subscribed && confirmedResources.length > 0) {
        clearTimeout(timeout)
        subscribed = true
        // A socket that repeatedly closes just after acknowledgement is still unstable.
        stableTimer = setTimeout(() => { failures = 0 }, STABLE_SUBSCRIPTION_MS)
        if (needsRecovery) {
          needsRecovery = false
          onResources(confirmedResources, true)
        }
        onPhase("subscribed", true)
      } else if (message?.type === "change" && confirmedResources.length > 0) {
        // The server can send authority changes before an acknowledgement.
        onResources(confirmedResources)
      }
    }
    connection.onerror = fail
    connection.onclose = fail
  }

  onPhase("connecting")
  void connect()
  return () => {
    closed = true
    clearTimeout(retryTimer)
    disposeAttempt?.()
  }
}

/** Subscribe to company-scoped realtime invalidations once session authority is ready. */
export function useLumiereRealtime(options: {
  queryClient: QueryClient
  organizationId?: number
  activeCompanyId?: number | null
  actorIdentity?: string | null
  resources: readonly string[]
  enabled?: boolean
  /** Hosted sessions use host-only handshake cookies and must stay on the current origin. */
  sameOrigin?: boolean
  /** Refresh an HTTP-only handshake credential before connecting. Never put bearer tokens in URLs. */
  beforeConnect?: (signal: AbortSignal) => Promise<void>
}) {
  const {
    queryClient,
    organizationId,
    activeCompanyId,
    actorIdentity,
    enabled = true,
    sameOrigin = false,
  } = options
  const beforeConnect = useRef(options.beforeConnect)
  beforeConnect.current = options.beforeConnect
  const resourcesKey = JSON.stringify(options.resources)

  useEffect(() => {
    if (!enabled || organizationId == null || organizationId <= 0
      || activeCompanyId == null || activeCompanyId <= 0 || !actorIdentity) return
    const authorityKey = realtimeAuthorityKey(organizationId, activeCompanyId, actorIdentity)
    queryClient.setQueryDefaults(authorityKey, { gcTime: Infinity, staleTime: Infinity })
    const previous = queryClient.getQueryData<RealtimeAuthorityState>(authorityKey)
    let generation = previous?.generation ?? 0
    const publishAuthority = (phase: RealtimeAuthorityState["phase"], advance = false) => {
      const current = queryClient.getQueryData<RealtimeAuthorityState>(authorityKey)
      if (advance) generation = Math.max(generation, current?.generation ?? 0) + 1
      if (current && (current.generation > generation ||
          (current.generation === generation && current.phase === phase))) return
      queryClient.setQueryData<RealtimeAuthorityState>(authorityKey, { phase, generation })
    }

    let url: string
    try {
      url = resolveRealtimeWsUrl(sameOrigin)
    } catch {
      publishAuthority("reconnecting")
      return
    }
    if (!url) {
      publishAuthority("reconnecting")
      return
    }

    return startRealtimeConnection({
      organizationId,
      activeCompanyId,
      url,
      resources: JSON.parse(resourcesKey) as string[],
      beforeConnect: async (signal) => beforeConnect.current?.(signal),
      recoverOnSubscribe: generation > 0,
      onPhase: publishAuthority,
      onResources: (resources, recovery) => invalidateStdbQueryResources(
        queryClient, organizationId, resources, { cancelRefetch: !recovery },
      ),
    })
  }, [sameOrigin, queryClient, organizationId, enabled, activeCompanyId, actorIdentity, resourcesKey])
}
