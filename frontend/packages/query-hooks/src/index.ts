/**
 * React Query hooks for the Next.js BFF → Rust api-server (`/api/query/*`, `/api/operations/*`).
 * Web apps import from `@lumiere/query-hooks/hooks/<domain>` (or local `@/hooks/use-*` shims in the app).
 * Realtime cache invalidation: `hooks/realtime` (`useLumiereRealtime`) + optional `@lumiere/stdb` (`DbConnection` for native clients).
 */
export {
  LumiereApiProvider,
  getLumiereApiClient,
  getLumiereApiClientOrThrow,
  registerLumiereApiClient,
} from "@lumiere/api-client"
export * from "./http"
