lumiere-v-1/frontend/web/PHASE0_IMPLEMENTATION.md
```

# API Gateway Refactor - Phases 0-2 Implementation Summary

## Overview
Phase 0 of the API Gateway Refactor Plan has been implemented. This phase establishes a WebSocket proxy that hides the real SpacetimeDB host from the browser, providing an immediate security win.

## Architecture

```
Browser (SpacetimeDB SDK) → wss://your-app.com/api/stdb (Next.js custom server)
                                    ↓
                           server.js WebSocket proxy (Node.js)
                                    ↓
                           wss://maincloud.spacetimedb.com (real STDB)
```

The browser connects to `/api/stdb` on your domain, which is proxied by the custom Next.js server to the real SpacetimeDB host. The user's `stdb_token` cookie is read server-side and forwarded upstream, so each user retains their own SpacetimeDB identity.

## Files Created/Modified

### 1. `frontend/web/server.js` (NEW)
- Custom Next.js server with WebSocket proxy
- Handles HTTP requests normally via Next.js
- Intercepts WebSocket upgrades for `/api/stdb`
- Extracts `stdb_token` from cookies and injects it into upstream connection
- Bidirectional message piping between client and SpacetimeDB

### 2. `frontend/web/package.json` (MODIFIED)
- Changed `dev` script: `"next dev"` → `"node server.js"`
- Changed `start` script: `"next start"` → `"node server.js"`
- Added `ws: "^8.18.0"` dependency

### 3. `frontend/web/app/providers.tsx` (MODIFIED)
- Added `host` prop pointing to `/api/stdb` proxy path
- Added `moduleName=""` (empty, resolved server-side)

### 4. `frontend/web/Dockerfile` (NEW)
- Multi-stage Docker build optimized for production
- Copies `server.js` to runner stage
- Runs `node server.js` for production

### 5. `frontend/web/.env.example` (NEW)
- Server-only environment variables (no `NEXT_PUBLIC_` prefix):
  - `STDB_HOST` - SpacetimeDB WebSocket host
  - `STDB_MODULE` - Module/database name
  - `STDB_SERVER_TOKEN` - Admin token for server-side queries
  - `DEV_MOCK_ORG_ID` - Optional dev bypass

### 6. `frontend/web/app/api/health/route.ts` (NEW)
- Simple health check endpoint for Docker/container health checks
- Returns `{ status: 'ok', timestamp: ... }`

### 7. `frontend/packages/stdb/src/http.ts` (MODIFIED)
- Updated `resolveHost()` and `resolveModule()` to check `STDB_HOST` and `STDB_MODULE` first (server-only), then fall back to `NEXT_PUBLIC_*` vars

### 8. `frontend/packages/stdb/src/context.tsx` (MODIFIED)
- Changed `??` to `||` for `host` and `moduleName` resolution so empty strings are treated as falsy

## Environment Variables

### Before (exposed to browser):
```
NEXT_PUBLIC_STDB_HOST=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_STDB_MODULE=lumiere-v1
```

### After (server-only):
```
STDB_HOST=wss://maincloud.spacetimedb.com
STDB_MODULE=lumiere-v1
STDB_SERVER_TOKEN=<admin-token>
```

## Security Wins

1. **SpacetimeDB host never reaches browser** - Removed from `NEXT_PUBLIC_*` vars
2. **Module name hidden** - No longer exposed in client bundle
3. **Token travels only over your domain's TLS** - SpacetimeDB host is internal
4. **Authentication enforced at proxy layer** - WS rejects unauthenticated upgrades (401 before STDB connection)
5. **Server-side identity injection** - User's token is read from cookie and forwarded upstream securely

## Deployment

### Coolify/Scaleway Configuration
- **Build context:** Root of monorepo (where `pnpm-workspace.yaml` is)
- **Dockerfile path:** `frontend/web/Dockerfile`
- **Port:** `3000`
- **Health check:** `GET /api/health`
- **Environment variables:** Set `STDB_HOST`, `STDB_MODULE`, `STDB_SERVER_TOKEN` as secrets

### Running Locally

1. Install dependencies:
   ```bash
   cd frontend
   pnpm install
   ```

2. Set up environment:
   ```bash
   cd web
   cp .env.example .env.local
   # Edit .env.local with your values
   ```

3. Run dev server:
   ```bash
   pnpm dev
   # or: node server.js
   ```

## Phase 1 — Session Utility (✅ COMPLETE)

Phase 1 creates a universal session resolver that works for both web (HTTP-only cookies) and Expo/mobile (Authorization Bearer tokens).

### Files Created/Modified

1. **`frontend/web/lib/api-session.ts`** (NEW)
   - `resolveApiSession(req?)` - resolves session from cookies or Bearer header
   - Returns `ApiSession` with `stdbToken`, `identityHex`, `organizationId`, and `opts`
   - Supports dev mode bypass via `DEV_MOCK_ORG_ID` + `STDB_SERVER_TOKEN`

2. **`frontend/web/lib/stdb-session.ts`** (REFACTORED)
   - Now delegates to `api-session.ts` via `resolveApiSession()`
   - Maintains backward compatibility for existing RSC pages

3. **`frontend/web/middleware.ts`** (MODIFIED)
   - Added `extractBearerToken()` helper for Authorization header
   - Added `isAuthenticated()` that checks both cookies and Bearer tokens
   - API routes (`/api/*`) are allowed through for route-handler-level auth

---

## Phase 2 — HTTP Reducer Bridge (✅ COMPLETE)

Phase 2 implements the HTTP-based reducer call bridge, replacing WebSocket reducer calls with HTTP POST requests.

### Files Created/Modified

1. **`frontend/web/lib/stdb-reducer.ts`** (NEW)
   - `callReducer(reducerName, args, opts)` - POST to STDB reducer endpoint
   - `callReducersBatch(calls, opts)` - sequential batch execution
   - Config resolution from `STDB_HOST`, `STDB_MODULE`, `STDB_SERVER_TOKEN` env vars

2. **`frontend/web/tsconfig.json`** (MODIFIED)
   - Added path mapping for `@lumiere/stdb/server` to support subpath imports

3. **`frontend/web/next.config.mjs`** (MODIFIED)
   - Added `@lumiere/stdb` to `transpilePackages`
   - Fixed turbopack aliases to use relative paths
   - Added turbopack root configuration for monorepo support

### Usage Example

```typescript
// In an API route handler
import { resolveApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'

export async function POST(req: NextRequest) {
  const session = await resolveApiSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  await callReducer('create_lead', [session.organizationId, body], session.opts)
  return NextResponse.json({ ok: true }, { status: 201 })
}
```

---

## Next Steps (Phase 3+)

Phases 0-2 are complete and provide the foundation for the full API Gateway architecture. The subsequent phases will:

- **Phase 3:** Create API route handlers for all domains (reads + writes)
- **Phase 4:** Replace direct `@lumiere/stdb` imports with local React Query hooks
- **Phase 5:** Remove WebSocket from browser entirely (once all hooks migrated)
- **Phase 6:** Expo uses same API routes

## Verification

After deployment, verify:
1. WebSocket connections work via browser DevTools → Network → WS
2. Connection URL should be `wss://your-domain.com/api/stdb` (not the real STDB host)
3. Data still flows correctly (subscriptions work)
4. No `NEXT_PUBLIC_STDB_*` variables in client-side bundle

## Rollback Plan

If issues arise:
1. Revert `package.json` scripts to use `next dev` / `next start`
2. Restore `NEXT_PUBLIC_STDB_HOST` and `NEXT_PUBLIC_STDB_MODULE` in `.env`
3. Remove the `host` and `moduleName` props from `providers.tsx`
4. Delete `server.js`
