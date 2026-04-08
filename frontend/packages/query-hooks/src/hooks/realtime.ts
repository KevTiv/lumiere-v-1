"use client"

/**
 * Browser WebSocket to api-server `/v1/realtime/ws` (JSON `change` / `subscribed` / `error`).
 * Same-origin default: `ws(s)://<host>/api/realtime/ws` (proxied by `frontend/web/server.js` to Axum).
 */

import type { QueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { invalidateStdbQueryResources } from "./stdb"

function resolveRealtimeWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_REALTIME_WS_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/$/, "")
  }
  if (typeof window === "undefined") {
    return ""
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${window.location.host}/api/realtime/ws`
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
  resources: readonly string[]
  enabled?: boolean
}) {
  const { queryClient, organizationId, companyIds, resources, enabled = true } = options
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

    const connect = () => {
      if (closed) {
        return
      }
      const url = resolveRealtimeWsUrl()
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
    queryClient,
    organizationId,
    enabled,
    JSON.stringify(companyIds ?? []),
    resources,
  ])
}
