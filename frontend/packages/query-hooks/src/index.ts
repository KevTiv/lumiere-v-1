/**
 * React Query hooks for the Next.js BFF → Rust api-server (`/api/query/*`, `/api/call/*`).
 * Web apps import from `@lumiere/query-hooks/hooks/<domain>` (or local `@/hooks/use-*` shims in the app).
 * Optional SpacetimeDB WebSocket usage stays in `@lumiere/stdb` (`DbConnection`, `erp-subscriptions`).
 */
export {
  LumiereApiProvider,
  getLumiereApiClient,
  getLumiereApiClientOrThrow,
  registerLumiereApiClient,
} from "@lumiere/api-client"
export * from "./http"
