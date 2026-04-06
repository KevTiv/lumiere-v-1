/**
 * Shared browser API client for Next.js (cookies + optional Rust gateway path rewrite).
 * @see {@link createLumiereApiClient} in `@lumiere/api-client` — Expo uses the same factory with a non-empty baseUrl + Bearer token.
 */
import { createLumiereApiClient } from "@lumiere/api-client"
import { apiUrl } from "./api-url"

export const webApi = createLumiereApiClient({
  baseUrl: "",
  credentials: "include",
  rewritePath: apiUrl,
})
