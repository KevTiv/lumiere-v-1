/**
 * Browser fetch helper for `/api/*` routes that may be proxied to the Rust api-server.
 * Prefers {@link getLumiereApiClient} from `@lumiere/query-hooks` when `LumiereApiProvider` is mounted
 * (shared with `@lumiere/ui` / `@lumiere/stdb/browser-http`); otherwise uses the web singleton.
 * @see {@link getApiGatewayBaseUrl} in `./api-url`
 */
"use client"

import { getLumiereApiClient } from "@lumiere/api-client"

import { webApi } from "./lumiere-web-http"

export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const c = getLumiereApiClient()
  if (c) return c.apiFetch(input, init)
  return webApi.apiFetch(input, init)
}

export { apiUrl, getApiGatewayBaseUrl } from "./api-url"
