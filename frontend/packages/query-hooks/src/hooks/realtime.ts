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

function httpBaseToRealtimeWsUrl(baseHttp: string): string {
  const u = new URL(baseHttp.replace(/\/$/, ""))
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:"
  return `${wsProto}//${u.host}/v1/realtime/ws`
}

export function resolveRealtimeWsUrl(sameOrigin = false): string {
  if (sameOrigin) {
    if (typeof window === 'undefined') return ''
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
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

type ServerRealtimeMsg =
  | { type: "change"; resources?: string[] }
  | { type: "subscribed" }
  | { type: "error"; error?: string }

/**
 * Maintain a Lumiere realtime WebSocket: subscribe to `resources`, invalidate matching
 * `useStdbQuery` caches on each `change` message.
 */
export function useLumiereRealtime(options: {
  queryClient: QueryClient
  organizationId?: number
  companyIds?: readonly number[]
  activeCompanyId?: number | null
  resources: readonly string[]
  enabled?: boolean
  /** Hosted sessions use host-only handshake cookies and must stay on the current origin. */
  sameOrigin?: boolean
  /** Refresh an HTTP-only handshake credential before connecting. Never put bearer tokens in URLs. */
  beforeConnect?: () => Promise<void>
}) {
  const {
    queryClient,
    organizationId,
    companyIds,
    activeCompanyId,
    resources,
    enabled = true,
    sameOrigin = false,
  } = options
  const beforeConnectRef = useRef(options.beforeConnect)
  beforeConnectRef.current = options.beforeConnect
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources

  useEffect(() => {
    if (!enabled || organizationId == null || organizationId <= 0) {
      return
    }

    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null
    let attempt = 0

    const scheduleReconnect = () => {
      if (closed) {
        return
      }
      attempt += 1
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = async () => {
      try { await beforeConnectRef.current?.() } catch {
        scheduleReconnect()
        return
      }
      if (closed) {
        return
      }
      const url = resolveRealtimeWsUrl(sameOrigin)
      if (!url) {
        return
      }

      try {
        ws = new WebSocket(url)
      } catch (e) {
        console.warn("[lumiere:realtime] WebSocket construct failed", e)
        scheduleReconnect()
        return
      }

      ws.onopen = () => {
        attempt = 0
        const payload = {
          resources: [...resourcesRef.current],
          organizationId,
          companyIds: companyIds?.length ? [...companyIds] : [],
          activeCompanyId:
            activeCompanyId != null && activeCompanyId > 0 ? activeCompanyId : null,
        }
        try {
          ws?.send(JSON.stringify(payload))
        } catch (e) {
          console.warn("[lumiere:realtime] subscribe send failed", e)
        }
      }

      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") {
          return
        }
        let msg: ServerRealtimeMsg
        try {
          msg = JSON.parse(ev.data) as ServerRealtimeMsg
        } catch {
          return
        }
        if (msg.type === "change" && Array.isArray(msg.resources) && msg.resources.length > 0) {
          invalidateStdbQueryResources(queryClient, organizationId, msg.resources)
        } else if (msg.type === "error") {
          console.warn("[lumiere:realtime]", msg.error ?? "error")
        }
      }

      ws.onerror = () => {
        ws?.close()
      }

      ws.onclose = () => {
        ws = null
        if (!closed) {
          scheduleReconnect()
        }
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer)
      }
      ws?.close()
    }
  }, [
    sameOrigin,
    queryClient,
    organizationId,
    enabled,
    activeCompanyId,
    JSON.stringify(companyIds ?? []),
    resources,
  ])
}
