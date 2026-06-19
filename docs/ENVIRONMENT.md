# Lumiere environment configuration

This doc summarizes how **SpacetimeDB**, **Next.js**, **api-server**, and **gateways** expect configuration. Defaults are tuned for local development; production must set explicit values.

## Variable overview

| Variable | Used by | Purpose |
|----------|---------|---------|
| `STDB_HOST` | Rust services, Next server, scripts | SpacetimeDB HTTP base URL (`https://…` or `http://…`). Also accepts `NEXT_PUBLIC_STDB_HOST` (may be `wss://` — normalized to `https://`). |
| `STDB_MODULE` | Same | Published database / module name (`spacetime publish <name>`). Also `NEXT_PUBLIC_STDB_MODULE`. |
| `NEXT_PUBLIC_STDB_HOST` / `NEXT_PUBLIC_STDB_MODULE` | Browser bundle (inlined at build) | Client-side SDK connection; must match server for the same database. |
| `STDB_SERVER_TOKEN` | Next server, api-server | JWT for HTTP SQL and admin reducer calls. |
| `LUMIERE_API_SERVER_URL` | Next `lib/api-server-forward.ts` | Internal base URL of the Rust api-server for Next routes that still perform local side effects before proxying (e.g. `http://api-server:8082`). In development, defaults to `http://127.0.0.1:8082` if unset. |
| `AI_GATEWAY_URL` | api-server | Internal AI gateway base URL. Required in production; must not be `localhost`. |
| `STDB_TOKEN` | ai-gateway, iot-gateway | Service token for SpacetimeDB HTTP API (distinct from per-user tokens). |

### AI gateway (`ai-gateway`)

| Variable | Purpose |
|----------|---------|
| `EMBEDDING_PROVIDER` | Unified Qdrant embed backend: `ollama` (default), `mistral`, or `gemini` |
| `MISTRAL_API_KEY` / `GOOGLE_API_KEY` | Provider keys for LLM + embed when configured on `AiAgent` or `EMBEDDING_PROVIDER` |
| `OLLAMA_URL` | Local Ollama for embed, vision, and chat |
| `KONG_LLM_URL` | Optional internal Kong AI route for LLM chat (else direct provider HTTP) |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | BFF → gateway auth header |

Tenant LLM provider/model selection is stored in SpacetimeDB `AiAgent` rows (Mistral, Gemini, Ollama).

## Modes

### Local SpacetimeDB (`spacetime start`)

- **Makefile:** `STDB_MODULE`, `STDB_CLOUD_MODULE`, `STDB_HOST` — see `make check-env`.
- **Web:** Point `STDB_HOST` / `NEXT_PUBLIC_STDB_HOST` at `http://127.0.0.1:3000` (or your local server). Use a JWT from `spacetime login --server-issued-login local` for `STDB_SERVER_TOKEN`.

### Maincloud

- Set `STDB_HOST` / `NEXT_PUBLIC_STDB_HOST` to `https://maincloud.spacetimedb.com` (or `wss://` — it is normalized).
- Set `STDB_MODULE` and `NEXT_PUBLIC_STDB_MODULE` to your published database name.

### Production (api-server)

When `NODE_ENV=production` or `LUMIERE_ENV=production`, **api-server** requires:

- `STDB_MODULE` or `NEXT_PUBLIC_STDB_MODULE`
- `STDB_SERVER_TOKEN`
- `AI_GATEWAY_URL` (not pointing at localhost)

Run `make check-env-prod` to validate required production variables (see [`PRODUCTION_DEPLOY.md`](PRODUCTION_DEPLOY.md)).

## Realtime WebSocket (web app)

Kong/reverse-proxy deployments use same-origin realtime by default: `wss://<current-host>/v1/realtime/ws`. Plain Next.js development on `localhost:3000` still falls back to `ws://127.0.0.1:8082/v1/realtime/ws`.

Set `NEXT_PUBLIC_REALTIME_WS_URL` for an explicit websocket URL, or `NEXT_PUBLIC_API_GATEWAY_URL` only when the browser should connect directly to an api-server origin instead of the same-origin Kong front door.

## PostHog (product analytics)

Client and server use the **same project API key** (from [Project settings](https://eu.posthog.com/settings/project)). The Next.js app reverse-proxies ingestion through `/ingest/*` (see `next.config.mjs`); set hosts to match your PostHog region (EU vs US).

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_POSTHOG_TOKEN` | Browser + Next server | Project API key (required for any analytics in non-local builds that should report). |
| `NEXT_PUBLIC_POSTHOG_HOST` | Build-time rewrites + browser | Ingestion API origin, e.g. `https://eu.i.posthog.com` or `https://us.i.posthog.com`. Defaults to EU in `next.config.mjs` when unset. |
| `NEXT_PUBLIC_POSTHOG_ASSETS_HOST` | Build-time rewrites only | Static/array CDN, e.g. `https://eu-assets.i.posthog.com`. Inferred from `NEXT_PUBLIC_POSTHOG_HOST` when unset (eu vs us). |
| `NEXT_PUBLIC_POSTHOG_UI_HOST` | Client init | PostHog **app** URL for toolbar/session links, e.g. `https://eu.posthog.com`. Defaults to `https://eu.posthog.com`. |
| `POSTHOG_KEY` or `POSTHOG_API_KEY` | Server only (optional) | Overrides `NEXT_PUBLIC_POSTHOG_TOKEN` for `posthog-node` in API routes so you can keep one public key for the client and a separate key only on the server—omit to reuse the public token. |
| `POSTHOG_HOST` | Server only (optional) | Overrides `NEXT_PUBLIC_POSTHOG_HOST` for server-side capture. |

If `NEXT_PUBLIC_POSTHOG_TOKEN` is unset, the web app skips PostHog initialization and event helpers no-op (useful for local dev without a token).

Server routes call `captureServerEvent` in `lib/posthog-server.ts`, which flushes after each event (serverless-safe).
