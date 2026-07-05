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
| `LUMIERE_REDUCER_ALLOWLIST` | api-server | `strict` (production default) blocks bootstrap/test/import reducers on `POST /v1/call/{reducer}`; `off` disables filtering (local dev / e2e). |
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

### Staging (maincloud, non-production module)

Use a **separate** SpacetimeDB module on maincloud so staging never shares production tenant data. Treat staging like production for security (`LUMIERE_REDUCER_ALLOWLIST=strict`, real CORS, no localhost AI gateway).

| Variable | Staging value |
|----------|---------------|
| `STDB_MODULE` | Separate maincloud database name (e.g. `lumiere-staging`) — **not** the production module |
| `STDB_HOST` | `https://maincloud.spacetimedb.com` |
| `NEXT_PUBLIC_STDB_HOST` | Same as `STDB_HOST` (baked into web build) |
| `NEXT_PUBLIC_STDB_MODULE` | Same as `STDB_MODULE` (baked into web build) |
| `LUMIERE_ENV` | `staging` (optional; api-server production checks also accept `NODE_ENV=production` with a non-prod module) |
| `LUMIERE_REDUCER_ALLOWLIST` | `strict` — match production; blocks `seed_dev_data` and test reducers on generic `/v1/call/{reducer}` |
| `CORS_ORIGINS` | Staging web origin (e.g. `https://staging.example.com`) |
| `NEXT_PUBLIC_APP_URL` | Staging browser origin (same host as CORS entry) |

**Publish flow:**

```bash
# Point .env / compose at staging STDB_MODULE, then:
spacetime login
spacetime publish lumiere-staging --module-path spacetimedb --server maincloud
make check-env-prod   # validate staging .env (STDB_MODULE, tokens, AI_GATEWAY_URL, CORS, etc.)
docker compose up --build
```

Or use Makefile cloud targets with overrides:

```bash
make publish-cloud STDB_MODULE=lumiere-staging STDB_CLOUD_MODULE=lumiere-staging
```

**Data and seeding:** staging uses its own module — no production data. Seed tenants via the normal onboarding flow (`/onboarding` → `POST /api/bootstrap/tenant`). Do **not** rely on `seed_dev_data` in strict mode; use the dedicated bootstrap route (see [`PILOT_RUNBOOK.md`](PILOT_RUNBOOK.md) §2.1).

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

## Backup and export

SpacetimeDB CLI has **no** `backup` / `restore` / `dump` subcommands. Operators rely on hosted dashboard expectations (maincloud), local filesystem copy, and Lumiere’s partial tenant export.

| Mechanism | Scope | Restore |
|-----------|--------|---------|
| Maincloud dashboard | Module-level (hosted) | Contact SpacetimeDB — not documented in-repo |
| Local `E2E_STDB_DATA_DIR` tarball | Entire local SpacetimeDB data dir | Filesystem replace after `spacetime stop` (dev only) |
| `POST /v1/admin/organizations/{id}/export` | 13 org-scoped tables (see [`PILOT_RUNBOOK.md`](PILOT_RUNBOOK.md) §3.4) | **None** — archive / support only |
| [`scripts/backup-stdb.sh`](../scripts/backup-stdb.sh) | Logs + manifest; optional local data tar + tenant JSON | Same as above |

**Script env vars** (optional tenant JSON):

| Variable | Purpose |
|----------|---------|
| `BACKUP_DIR` | Output directory (default `./.tmp/stdb-backups`) |
| `BACKUP_ORG_ID` | Organization ID for admin export |
| `BACKUP_SESSION_TOKEN` | Superuser SpacetimeDB JWT (`Authorization: Bearer …`) |
| `LUMIERE_API_SERVER_URL` | api-server base for export curl (default `http://127.0.0.1:8082`) |
| `E2E_STDB_DATA_DIR` | Local SpacetimeDB data path (default `~/.local/share/spacetime/data`) |

**Limitations:** export is not a full module dump; large orgs may hit HTTP SQL limits; `product_product` is not a table name (export uses `product`). Do not treat export JSON as a DR restore source without a dedicated import pipeline ([prod-ops-export-v2] mission).
