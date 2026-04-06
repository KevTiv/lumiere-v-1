/**
 * HTTP client for the same Next.js routes as the web app (`EXPO_PUBLIC_LUMIERE_API_URL`, e.g. `http://192.168.x.x:3000`).
 */
import { createLumiereApiClient } from "@lumiere/api-client"

import { getBearerToken } from "./lumiere-session"

const baseUrl = (process.env.EXPO_PUBLIC_LUMIERE_API_URL ?? "").replace(/\/$/, "")

export const mobileApi = createLumiereApiClient({
  baseUrl,
  getAccessToken: getBearerToken,
})

export function getLumiereApiBaseUrl(): string {
  return baseUrl
}
