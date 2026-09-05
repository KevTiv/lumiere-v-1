# Production deployment

This checklist matches [`docker-compose.yml`](../docker-compose.yml) and runtime validation in **api-server** (`Config::from_env`) and **Next.js** (`lib/api-server-forward.ts`, `lib/ai-gateway-server.ts`).

Validate your host environment before deploy:

```bash
make check-env-prod
# or: scripts/check-prod-env.sh
```

Print the checklist without validating:

```bash
scripts/check-prod-env.sh --list
```

## Host `.env` (docker compose)

These variables use `${VAR:?set VAR}` in `docker-compose.yml` — Compose fails at parse time if they are missing:

| Variable | Used by | Notes |
|----------|---------|--------|
| `STDB_MODULE` | web, api-server, ai-gateway | Published SpacetimeDB database name |
| `STDB_SERVER_TOKEN` | web, api-server | Admin/service JWT for HTTP SQL and auth reducers |
| `STDB_TOKEN` | ai-gateway | Service token for SpacetimeDB HTTP API (not the same as `STDB_SERVER_TOKEN`) |
| `AI_CERTIFICATION_STDB_TOKEN` | ai-gateway | Dedicated certification executor token; never reuse browser, API, or general gateway credentials |
| `AI_CERTIFICATION_RUNTIME_HASH` | ai-gateway | Registered immutable executor digest (`sha256:` plus 64 lowercase hex characters) |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | web, api-server, ai-gateway | Shared secret (`X-Lumiere-Gateway-Secret`) |

Common optional host overrides (have defaults in compose):

| Variable | Default in compose | Purpose |
|----------|-------------------|---------|
| `STDB_HOST` | `https://maincloud.spacetimedb.com` | SpacetimeDB HTTP base |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:8000` | Public app URL (set to your Kong/proxy URL in prod) |
| `CORS_ORIGINS` | `http://localhost:8000,...` | Allowed browser origins for api-server CORS |
| `EMBEDDING_PROVIDER` | `ollama` | ai-gateway embed backend |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Local Ollama when using Ollama embed/LLM |

## Service: api-server

Set `NODE_ENV=production` or `LUMIERE_ENV=production`. **api-server refuses to start** if any of these are missing or invalid:

| Variable | Required | Notes |
|----------|----------|--------|
| `STDB_MODULE` or `NEXT_PUBLIC_STDB_MODULE` | yes | Database name |
| `STDB_SERVER_TOKEN` | yes | Non-empty |
| `AI_GATEWAY_URL` | yes | Internal ai-gateway base URL; must not contain `localhost` or `127.0.0.1` |
| `AI_GATEWAY_REQUIRED` | optional (default true) | `/health/ready` fails unless the AI gateway responds successfully. Set false only for an intentional degraded deployment. |
| `STDB_HOST` or `NEXT_PUBLIC_STDB_HOST` | recommended | Defaults to maincloud if unset |
| `CORS_ORIGINS` | recommended | Comma-separated origins for credentialed browser calls |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes (compose) | BFF → gateway auth |
| `STDB_CREDENTIAL_ENCRYPTION_KEY` | for password auth | 64 hex chars (32-byte AES key) |
| `WORKOS_CLIENT_ID` | optional | When set, password routes return 410 |
| `RESEND_API_KEY` | optional | Transactional email |

In compose, `AI_GATEWAY_URL` is wired to `http://ai-gateway:8080`.

The api-server endpoints have separate purposes: `/health` is liveness-only, while
`/health/ready` checks PostgreSQL, SpacetimeDB, and the configured AI gateway. Production
compose sets `AI_GATEWAY_REQUIRED=true`. The slim Rust images do not contain `curl`, so
compose does not add an in-container healthcheck dependency gate. Run the host/sibling
probe instead:

```bash
node scripts/check-compose-readiness.mjs \
  --api http://api-server:8082/health/ready \
  --ai http://ai-gateway:8080/health/ready \
  --probe owner-report=http://owner-report-worker:8091/health/ready \
  --probe workflow=http://workflow-worker:8093/health/ready \
  --probe projection=http://projection-worker:8096/health/ready \
  --probe chromium=http://chromium-worker:8090/health/ready
```

The projection worker is the sole SpacetimeDB-to-PostgreSQL durability and C5
finalization service. After applying the ordered commit stream, it reads the
pinned generated archive manifest and runs each supported candidate through
its reviewed domain finalizer. Unknown candidate/reducer/mode combinations
fail startup instead of being skipped. Set `LUMIERE_FINALIZATION_WORKER_BATCH`
to a value from 1 through 200 (default 100).

Before enabling cooling for an organization, register the projection worker's
dedicated SpacetimeDB identity under the service name `projection_worker` with
`register_cold_tier_service_identity`. The registration is a direct owner-token
operations action and must not be exposed through the application API. The
retired `audit_cold_drainer` and `pos_order_cold_drainer` service names are no
longer accepted by finalization reducers.

When running the probe from a sibling container, use Compose service DNS names such as
`chromium-worker`; host-side probes should use published or externally routed hostnames.

## Service: web (Next.js)

| Variable | Required | Notes |
|----------|----------|--------|
| `LUMIERE_API_SERVER_URL` | yes | Internal api-server base (compose: `http://api-server:8082`) |
| `STDB_SERVER_TOKEN` | yes | Server-side SQL and auth |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes | AI BFF routes |
| `STDB_MODULE` / `NEXT_PUBLIC_STDB_MODULE` | yes | Must match published database |
| `STDB_HOST` / `NEXT_PUBLIC_STDB_HOST` | yes | SpacetimeDB host |
| `NEXT_PUBLIC_APP_URL` | recommended | Public URL for links and cookie scope |
| `LUMIERE_AI_GATEWAY_URL` | in compose | Internal ai-gateway (`http://ai-gateway:8080`) |

### Build-time `NEXT_PUBLIC_*`

The web Docker image runs `pnpm --filter web build` without build-args today. For production, ensure **`NEXT_PUBLIC_STDB_MODULE`** and **`NEXT_PUBLIC_STDB_HOST`** are available at **build** time (Docker build args or CI env) so the client bundle matches `STDB_MODULE` / `STDB_HOST`.

Realtime WebSocket: Kong/same-origin deployments use `wss://<host>/v1/realtime/ws` by default. Override with `NEXT_PUBLIC_REALTIME_WS_URL` or `NEXT_PUBLIC_API_GATEWAY_URL` if the browser should connect elsewhere (see `docs/ENVIRONMENT.md`).

## Service: ai-gateway

| Variable | Required | Notes |
|----------|----------|--------|
| `STDB_MODULE` | yes | |
| `STDB_TOKEN` | yes | Service account token |
| `AI_CERTIFICATION_STDB_TOKEN` | yes | Dedicated token matching the active organization certification runtime profile |
| `AI_CERTIFICATION_RUNTIME_HASH` | yes | Exact digest registered in that runtime profile |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes | |
| `QDRANT_URL` | in compose | `http://qdrant:6334` (gRPC) |
| `STDB_HOST` | recommended | Defaults in gateway dev config only |

Provider keys (`MISTRAL_API_KEY`, `GOOGLE_API_KEY`, etc.) depend on tenant `AiAgent` rows and `EMBEDDING_PROVIDER`.

The gateway exposes `/health` for process liveness and `/health/ready` for a
bounded, read-only SpacetimeDB and primary-Qdrant check. Readiness also validates
configured provider credentials/endpoints and calls only safe Ollama `/api/tags`
and the operator-supplied `KONG_LLM_READINESS_URL`. It never generates text,
vision output, searches, or embeddings. Monitor Mistral, Gemini, Unstructured,
and Tavily runtime errors separately because their readiness is configuration-only.

Before enabling certification for an organization, an active platform
superuser must call `register_ai_skill_certification_runtime_profile` directly
in SpacetimeDB with the dedicated token's exact executor identity and the same
`AI_CERTIFICATION_RUNTIME_HASH`. The public reducer endpoint intentionally
blocks runtime registration, claims, completion, and failure. Rotate a runtime
by registering a new profile, deploy the matching token/hash together, and
allow already-pinned jobs to finish; promotion accepts evidence from only the
currently active profile.

## Quick start (Docker)

```bash
cp frontend/web/.env.example .env   # edit with production values
make check-env-prod
docker compose up --build
```

Kong listens on `:8000`; api-server, web, and ai-gateway are internal-only (`expose`, not published).

## Related docs

- [`docs/ENVIRONMENT.md`](ENVIRONMENT.md) — full variable reference and local/maincloud modes
- [`Makefile`](../Makefile) — `make check-env-prod`, SpacetimeDB publish targets
