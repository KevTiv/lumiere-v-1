# Pilot runbook

Operational checklist for running Lumiere ERP with pilot tenants. This document is for DevOps and support — not a product overview.

**Related:** [`PRODUCTION_DEPLOY.md`](PRODUCTION_DEPLOY.md) · [`ENVIRONMENT.md`](ENVIRONMENT.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`MVP_WORKFLOW_CONTRACT.md`](MVP_WORKFLOW_CONTRACT.md)

---

## 1. Pre-pilot checklist

Run these **before** onboarding the first pilot tenant or opening production traffic.

### 1.1 Validate environment variables

```bash
# From repo root — exits 1 if required vars are missing
make check-env-prod

# Print checklist only (no validation)
scripts/check-prod-env.sh --list
```

`scripts/check-prod-env.sh` loads (without overriding existing exports): `.env`, `.env.local`, `api-server/.env.local`, `frontend/web/.env.local`.

**Required host variables** (see [`docker-compose.yml`](../docker-compose.yml) `${VAR:?}` guards and [`docs/PRODUCTION_DEPLOY.md`](PRODUCTION_DEPLOY.md)):

| Variable | Used by | Notes |
|----------|---------|--------|
| `STDB_MODULE` | web, api-server, ai-gateway | Published SpacetimeDB database name |
| `STDB_SERVER_TOKEN` | web, api-server | Admin/service JWT for HTTP SQL and auth |
| `STDB_TOKEN` | ai-gateway | Service token for SpacetimeDB HTTP API (**not** the same as `STDB_SERVER_TOKEN`) |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | web, api-server, ai-gateway | Shared secret (`X-Lumiere-Gateway-Secret`) |

**api-server** (refuses to start in production without these — see `api-server/src/config.rs`):

| Variable | Required | Notes |
|----------|----------|--------|
| `STDB_MODULE` or `NEXT_PUBLIC_STDB_MODULE` | yes | |
| `STDB_SERVER_TOKEN` | yes | |
| `AI_GATEWAY_URL` | yes | Must not contain `localhost` / `127.0.0.1` in production |
| `STDB_HOST` or `NEXT_PUBLIC_STDB_HOST` | recommended | Defaults to maincloud |
| `CORS_ORIGINS` | recommended | Comma-separated browser origins |
| `STDB_CREDENTIAL_ENCRYPTION_KEY` | for password auth | 64 hex chars (32-byte AES key) |

**web (Next.js)** — see [`frontend/web/.env.example`](../frontend/web/.env.example):

| Variable | Required | Notes |
|----------|----------|--------|
| `LUMIERE_API_SERVER_URL` | yes (compose sets `http://api-server:8082`) | |
| `STDB_SERVER_TOKEN` | yes | |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes | |
| `STDB_MODULE` / `NEXT_PUBLIC_STDB_MODULE` | yes | Must match published database |
| `STDB_HOST` / `NEXT_PUBLIC_STDB_HOST` | yes | |
| `NEXT_PUBLIC_APP_URL` | recommended | Public URL for links and cookies |

**Build-time:** bake `NEXT_PUBLIC_STDB_MODULE` and `NEXT_PUBLIC_STDB_HOST` into the web Docker image at build time so the client bundle matches server config (see [`PRODUCTION_DEPLOY.md`](PRODUCTION_DEPLOY.md) § Build-time `NEXT_PUBLIC_*`).

**Optional but recommended:** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (invite emails), `WORKOS_*` (enterprise SSO), `MISTRAL_API_KEY` / `GOOGLE_API_KEY` / `OLLAMA_URL` (AI).

### 1.2 SpacetimeDB module

```bash
# Login (maincloud default server)
spacetime login

# Publish module to maincloud (pilot production)
make publish-cloud
# STDB_MODULE and STDB_CLOUD_MODULE default in Makefile — override: make publish-cloud STDB_MODULE=my-pilot-db

# Destructive republish (wipes all tenant data)
make publish-cloud-clear
```

Local dev module (not for pilot production):

```bash
make start          # spacetime start
make publish        # spacetime publish … --server local
make publish-clear  # --clear-database
```

### 1.3 Docker stack

```bash
cp frontend/web/.env.example .env   # edit with production values
make check-env-prod
docker compose up --build
```

Kong listens on `:8000` ([`infra/kong/kong.yml`](../infra/kong/kong.yml)). api-server, web, and ai-gateway are internal-only (`expose`, not published).

### 1.4 Pre-pilot sign-off

- [ ] `make check-env-prod` passes
- [ ] Module published to target `STDB_MODULE` on maincloud (or documented local-only pilot)
- [ ] `docker compose up` healthy; app reachable at `NEXT_PUBLIC_APP_URL`
- [ ] E2E golden gate passes (§7)

---

## 2. Tenant onboarding flow

### 2.1 New organization (first user)

```
/sign-up  →  POST /api/auth/signup  →  /onboarding  →  POST /api/bootstrap/tenant  →  /overview
```

| Step | Route / file | What happens |
|------|----------------|--------------|
| 1. Register | [`frontend/web/app/(auth)/sign-up/page.tsx`](../frontend/web/app/(auth)/sign-up/page.tsx) | Email/password → `POST /api/auth/signup` (api-server). WorkOS path if `NEXT_PUBLIC_WORKOS_REDIRECT_URI` is set. |
| 2. Redirect | [`frontend/web/lib/post-auth-destination.ts`](../frontend/web/lib/post-auth-destination.ts) | Users without an organization → `/onboarding`. |
| 3. Tenant setup | [`frontend/web/app/(auth)/onboarding/page.tsx`](../frontend/web/app/(auth)/onboarding/page.tsx) | Collects org name, code, timezone, currency. |
| 4. Bootstrap API | [`frontend/web/app/api/bootstrap/tenant/route.ts`](../frontend/web/app/api/bootstrap/tenant/route.ts) → [`api-server/src/routes/bootstrap.rs`](../api-server/src/routes/bootstrap.rs) `/v1/bootstrap/tenant` | Calls `bootstrap_new_tenant` reducer with session token. Fails with **409** if user already belongs to an org. |
| 5. App entry | `/overview` | User has org membership, default company, seeded form configs (when `seedFormConfigs: true`). |

**Production note:** `bootstrap_new_tenant` is **blocked** on generic `POST /api/call/bootstrap_new_tenant` in strict allowlist mode (`api-server/src/reducer_allowlist.rs`). Onboarding uses the **dedicated** `/v1/bootstrap/tenant` route instead — do not remove or bypass this route in production.

### 2.2 Invite additional users

Admin with `admin:users` create permission:

1. Open **Settings** → **Users** ([`/settings`](../frontend/web/app/(modules)/settings/page.tsx) → [`frontend/packages/ui/src/settings/user-management.tsx`](../frontend/packages/ui/src/settings/user-management.tsx)).
2. Click **Invite user** (plus icon). Enter email and assign at least one role.
3. UI calls `POST /api/auth/invite` ([`api-server/src/routes/auth.rs`](../api-server/src/routes/auth.rs)) → `create_user_invite` reducer.
4. If `RESEND_API_KEY` is configured, invitee receives email with link to `/accept-invite?token=…`.
5. Invitee completes [`frontend/web/app/(auth)/accept-invite/page.tsx`](../frontend/web/app/(auth)/accept-invite/page.tsx) → `POST /api/auth/accept-invite` → account created, org membership + role assigned, `mark_invite_accepted`.

**Do not use** Settings → superuser **Invite (direct reducer)** (`createUserInviteDirect` in [`settings-client.tsx`](../frontend/web/app/(modules)/settings/settings-client.tsx)) for production onboarding — that path bypasses email delivery and is superuser-only.

### 2.3 Verify onboarding

- New user lands on `/overview` with sidebar visible (`data-testid="dashboard-sidebar"`).
- Settings → Users lists the invited member after accept.
- Settings → Organization shows the tenant created at bootstrap.

---

## 3. SpacetimeDB backup and restore

The SpacetimeDB CLI **does not** ship `backup`, `restore`, `dump`, or `export` subcommands (as of CLI `spacetime --help`). Use the procedures below.

### 3.1 Maincloud (pilot production)

| Operation | Command / action |
|-----------|------------------|
| **Monitor** | Dashboard: `https://spacetimedb.com/@<username>/<STDB_MODULE>` (see workspace SpacetimeDB rules) |
| **Tail logs** | `make logs-cloud` → `spacetime logs $(STDB_CLOUD_MODULE) --server maincloud` |
| **Module update** | `make publish-cloud` builds and size-checks the stripped optimized WASM before publishing; preserves data unless the schema requires a clear |
| **Destructive reset** | `make publish-cloud-clear` publishes the same checked artifact with `--clear-database` — **wipes all tenants** |
| **Ad-hoc read** | `spacetime sql <STDB_MODULE> "SELECT …" --server maincloud` (CLI marks `sql` as unstable) |

There is no documented maincloud point-in-time restore in-repo. Treat `publish-cloud-clear` as irreversible for pilot data. Coordinate with SpacetimeDB maincloud support for hosted backup expectations before promising RPO/RTO to pilots.

The cloud targets accept `STDB_REMOTE_SERVER=<nickname-or-url>`, so a durable
standalone SpacetimeDB deployment can replace Maincloud without changing the
application contract. Persistent storage, TLS, backups, and availability for
that server remain deployment responsibilities.

### 3.2 Local (`spacetime start`)

| Operation | Command / action |
|-----------|------------------|
| **Data directory** | `~/.local/share/spacetime/data` (Makefile: `E2E_STDB_DATA_DIR`) |
| **Backup (filesystem)** | `spacetime stop`, copy `E2E_STDB_DATA_DIR` to safe storage, `spacetime start` |
| **Restore (filesystem)** | `spacetime stop`, replace data dir from backup, `spacetime start` |
| **Wipe all local DBs** | `make e2e-wipe-local-stdb` (stops server, deletes data dir) |
| **Republish + clear** | `make publish-clear` |
| **Tail logs** | `make logs` → `spacetime logs $(STDB_MODULE) --server local` |

### 3.3 Module rebuild without filesystem backup

When you only need a clean module + seed (E2E / dev):

```bash
E2E_CLEAR_DB=1 make e2e-smoke-setup   # publishes with --clear-database, runs seeds
```

### 3.4 Partial tenant export (api-server)

SpacetimeDB has **no** native full-database backup. Lumiere provides a **best-effort, partial** per-organization JSON export for pilot DR drills — not a restore pipeline.

| Item | Detail |
|------|--------|
| **Endpoint** | `POST /v1/admin/organizations/{org_id}/export` ([`api-server/src/routes/admin.rs`](../api-server/src/routes/admin.rs)) |
| **Auth** | Superuser session (`user_profile.is_superuser`); pass `Authorization: Bearer <stdb_token>` or `stdb_token` cookie |
| **Output** | JSON attachment with `exportTables` metadata and per-table row arrays |
| **Restore** | **Not implemented** — export is for offline archive / support investigation only |

**Tables included today** (13 — filtered `WHERE organization_id = {org_id}`):

| Domain | Tables |
|--------|--------|
| Org / access | `company`, `user_organization` |
| CRM | `contact`, `lead` |
| Sales / purchasing | `sale_order`, `purchase_order` |
| Accounting | `account_account`, `account_journal`, `account_move`, `account_payment` |
| Inventory | `product`, `stock_picking`, `stock_move` |

**Not exported** (examples): `audit_log`, `organization`, `organization_settings`, `billing_account`, `user_profile`, `role`, HR/project/manufacturing tables, attachments, AI/RAG indexes, form configs, and anything without a simple org-scoped `SELECT *`. Large tenants may hit HTTP SQL row/size limits — treat export as **incomplete** until verified row counts match the UI.

**Manual export:**

```bash
curl -sS -X POST "http://127.0.0.1:8082/v1/admin/organizations/1/export" \
  -H "Authorization: Bearer $BACKUP_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{}' \
  -o org-1-export.json
```

**Backup drill script** ([`scripts/backup-stdb.sh`](../scripts/backup-stdb.sh)):

```bash
# Logs + manifest (always)
./scripts/backup-stdb.sh "$STDB_MODULE" maincloud

# Optional tenant JSON when api-server is up and you have a superuser JWT
BACKUP_ORG_ID=1 BACKUP_SESSION_TOKEN="$STDB_SERVER_TOKEN" \
  LUMIERE_API_SERVER_URL=http://127.0.0.1:8082 \
  ./scripts/backup-stdb.sh "$STDB_MODULE" local
```

Artifacts land in `.tmp/stdb-backups/` (override with `BACKUP_DIR`). See [`ENVIRONMENT.md`](ENVIRONMENT.md) § Backup and export for env vars.

**Honest limits for pilots:** do not promise point-in-time restore or full tenant DR from this export alone. Coordinate RPO/RTO with SpacetimeDB maincloud for hosted data; use filesystem copy (§3.2) only for local dev.

---

## 4. Incident response

### 4.1 Health checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| **api-server liveness** | `GET http://<api-host>:8082/health` | HTTP 200 without dependency checks |
| **api-server readiness** | `GET http://<api-host>:8082/health/ready` | HTTP 200 only when PostgreSQL, SpacetimeDB, and the configured AI gateway are ready |
| **ai-gateway** | `GET http://<ai-gateway-host>:8080/health` | JSON `{"status":"ok","service":"lumiere-ai-gateway"}` (`ai-gateway/src/routes/health.rs`) |
| **ai-gateway readiness** | `GET http://<ai-gateway-host>:8080/health/ready` | HTTP 200 only when SpacetimeDB, primary Qdrant, configured provider settings, Ollama metadata, and any configured Kong readiness endpoint are ready |
| **chromium-worker liveness** | `GET http://<chromium-host>:8090/health` | HTTP 200 when the worker process is listening |
| **chromium-worker readiness** | `GET http://<chromium-host>:8090/health/ready` | HTTP 200 only after a bounded Chromium launch/connect check |
| **AI via web BFF** | `GET /api/ai/health` (authenticated) | Proxies ai-gateway readiness; see [`frontend/web/app/api/ai/health/route.ts`](../frontend/web/app/api/ai/health/route.ts) |
| **Web (compose)** | `curl -fsS $NEXT_PUBLIC_APP_URL` | HTML shell loads |
| **SpacetimeDB** | `spacetime server ping` or `curl -fsS $STDB_HOST/v1/identity -X POST` | Reachable |

In Docker Compose, api-server and ai-gateway are not port-published. Probe from
an operator or sibling container on the Compose network; slim production images
do not guarantee that `curl` is installed.

```bash
# Run from the host, or from a sibling container with Node 18+ on the Compose network.
node scripts/check-compose-readiness.mjs \
  --api http://<api-host>:8082/health/ready \
  --ai http://<ai-gateway-host>:8080/health/ready \
  --probe chromium=http://<chromium-host>:8090/health/ready
```

The probe uses only Node's built-in `fetch`, applies a bounded timeout, and exits non-zero
if any dependency is not ready. Add repeatable `--probe NAME=URL` arguments for
worker readiness endpoints. All probes start in parallel. Use `curl` directly
only when it is available.

Kong (`:8000`) does not expose a dedicated `/health` route in [`infra/kong/kong.yml`](../infra/kong/kong.yml); use service-level checks above.

### 4.2 Logs

| Source | Command |
|--------|---------|
| **SpacetimeDB (maincloud)** | `make logs-cloud` or `spacetime logs $STDB_MODULE --server maincloud` |
| **SpacetimeDB (local)** | `make logs` or `spacetime logs $STDB_MODULE --server local` |
| **api-server (compose)** | `docker compose logs -f api-server` |
| **web (compose)** | `docker compose logs -f web` |
| **ai-gateway (compose)** | `docker compose logs -f ai-gateway` |
| **Kong (compose)** | `docker compose logs -f kong` |
| **Local E2E** | `.tmp/e2e/api-server.log`, `.tmp/e2e/spacetime.log`, `.tmp/e2e/next.log` |

### 4.3 Common failure modes

| Symptom | Check |
|---------|--------|
| 401 on `/api/query/*` or `/api/call/*` | User session missing or expired: check `stdb_token` cookie / `Authorization: Bearer` from sign-in. **Do not** use `STDB_SERVER_TOKEN` in the browser — it is server-side only and will not establish a user session. Re-sign-in at `/sign-in`. |
| 403 cross-org | api-server rejects `organizationId` override mismatch (`api-server/src/http_app.rs` `get_query`) |
| 403 on reducer call | `LUMIERE_REDUCER_ALLOWLIST=strict` blocking bootstrap/test/import reducers |
| AI features down | `AI_GATEWAY_URL`, `LUMIERE_AI_GATEWAY_INTERNAL_SECRET`, Qdrant (`docker compose logs qdrant`), `OLLAMA_URL` / provider API keys |
| Realtime stale | WebSocket `/v1/realtime/ws` via Kong or `NEXT_PUBLIC_REALTIME_WS_URL` |
| Invite email missing | `RESEND_API_KEY` unset — invite row still created; share `/accept-invite?token=…` manually |

---

## 5. Tenant support workflow

### 5.1 Impersonation

**Not supported.** There is no admin impersonation or “login as user” flow in the codebase. Support staff cannot view the app as a tenant user without that user's credentials.

Workarounds:

- Ask the tenant admin to reproduce with screen share.
- Use **Settings → Audit** (admin permission) to inspect `audit_log` rows for the org.
- Use `spacetime sql` with `STDB_SERVER_TOKEN` for read-only investigation (maincloud/local) — respect tenant privacy and access policy.

### 5.2 Data export (what exists today)

| Data | Export path |
|------|-------------|
| **Audit log** | Settings → Platform → **Audit** → Export CSV ([`frontend/packages/ui/src/settings/audit-log.tsx`](../frontend/packages/ui/src/settings/audit-log.tsx)); API: `GET /api/query/audit-log` |
| **Partial tenant JSON** | Superuser `POST /v1/admin/organizations/{id}/export` — 13 tables, no restore (§3.4) |
| **Full tenant dump** | **Not implemented** — export omits most module tables; no bulk UI |
| **Per-module CSV import (reverse)** | UI can import CSV in several modules; production `strict` allowlist blocks `import_*_csv` on generic `/api/call` (see §6) |

### 5.3 Admin-only paths (not for routine support)

[`frontend/web/app/(modules)/settings/settings-client.tsx`](../frontend/web/app/(modules)/settings/settings-client.tsx) exposes superuser direct reducers (e.g. `createUserInviteDirect`, password hash updates). These require `is_superuser` on `user_profile` (`spacetimedb/src/core/auth.rs`). Do not use for normal pilot support.

### 5.4 Password / access recovery

- **Forgot password:** `/forgot-password` → api-server auth routes.
- **Admin password reset:** superuser-only reducers in Settings — not self-service for support without superuser identity.

---

## 6. Known limitations (pilot contract)

Document these with pilot customers before go-live.

### 6.1 CSV import and production allowlist

Bulk CSV reducers (`import_*_csv`) are **blocked** on `POST /api/call/{reducer}` when `LUMIERE_REDUCER_ALLOWLIST=strict` (production default). Use the dedicated import endpoint instead:

- `POST /api/import/{entity}` (BFF → `POST /v1/import/{entity}` on api-server)
- Settings → **Guided data import** wizard (AI analyze + import)

See `api-server/src/routes/import.rs` and `frontend/web/components/guided-import-wizard.tsx`.

AI-assisted import preview/analyze: `/api/ai/import/preview` and `/api/ai/import/analyze`.

### 6.2 AI gateway dependency

AI features (ERP Assistant RAG, action drafts, import mapping) require:

- **ai-gateway** service ([`ai-gateway/`](../ai-gateway/))
- **Qdrant** (`QDRANT_URL`, compose service `qdrant`)
- **Embedding/LLM provider:** `EMBEDDING_PROVIDER`, `OLLAMA_URL`, and/or `MISTRAL_API_KEY` / `GOOGLE_API_KEY` per tenant `AiAgent` rows

`mvp-ai-rag.spec.ts` **skips** when gateway is unavailable. Pilot without AI: disable AI nav items or accept degraded assistant features.

### 6.3 Module breadth vs workflow depth

The sidebar exposes many modules ([`frontend/packages/ui/src/pages/dashboard-sidebar.tsx`](../frontend/packages/ui/src/pages/dashboard-sidebar.tsx)): Accounting, Sales, CRM, Purchasing, Inventory, HR, Projects, Manufacturing, Helpdesk, IoT, etc.

**Pilot-validated golden paths** (see [`MVP_WORKFLOW_CONTRACT.md`](MVP_WORKFLOW_CONTRACT.md)):

- **Lead-to-cash:** CRM → Sales → Inventory fulfillment → Accounting invoice/payment (`mvp-lead-to-cash.spec.ts`)
- **Procure-to-pay:** Purchasing → receive → vendor bill → post (`mvp-procure-to-pay.spec.ts`)

Other modules are reachable in UI but may lack E2E proof, incomplete audit coverage, or shallow workflow depth. Set pilot scope explicitly — do not imply full Odoo parity.

### 6.4 Other production guards

- Generic `/api/call` cannot invoke `seed_dev_data`, domain test reducers, or `delete_organization` in strict mode.
- Cross-org data access is rejected at api-server.
- E2E and local dev use `seed_dev_data` + `seed-test-user` instead of live bootstrap ([`Makefile`](../Makefile) `e2e-smoke-setup`).
- Purchasing Phase 0 containment blocks landed-cost application and all advanced
  procurement reducers for ordinary tenants. The explicit organization feature
  flag `purchasing_ri_phase0_unsafe_actions` may be added only after the tenant's
  integrity inventory has been reviewed and every finding has a documented
  quarantine/backfill decision. Seeded `demo_mode` organizations retain these
  actions for isolated characterization; that flag is not a production bypass.
- Before any Purchasing opt-in, run `purchasing_integrity_inventory` and preserve
  the `[purchasing-integrity]` log lines as described in
  [`purchasing-integrity-inventory-baseline.md`](integrity/purchasing-integrity-inventory-baseline.md).

---

## 7. E2E verification gate

### 7.1 CI — E2E smoke (recommended merge gate)

GitHub Actions workflow **[E2E smoke](../.github/workflows/e2e-smoke.yml)** runs browser smoke against local SpacetimeDB + api-server + Next.js.

| Trigger | Suite | Clear DB |
|---------|-------|----------|
| **Pull request** (classifier-selected application/shared/build changes, including frontend) | `p0` only | no |
| **Push to `main`** (classifier-selected changes) | `full` once, includes P0 | yes |
| **Weekly schedule** (Mon 08:00 UTC) | `full` | yes |
| **workflow_dispatch** | operator choice | configurable |

**Required checks for merge (operator action):** prefer the stable **`CI gate`** and **`E2E gate`** job checks from the corresponding workflows. These reject failed/cancelled/missing selected jobs and accept deliberate classifier skips. Existing branch-protection settings are not changed by this branch; migrate any dynamic `Playwright smoke (p0)` requirement through GitHub settings. See the [build and CI guide](guides/build-and-ci-dx.md).

**P0 scope:** tests tagged `@p0`, excluding `@dev-fixture`. Covers auth shell, module smoke, MVP golden paths, and core mutation suites. Use `pnpm --dir frontend/web exec playwright test --list --grep @p0 --grep-invert @dev-fixture` for the current inventory; counts change as tests are added.

**Reproduce CI P0 locally** (same suite as PRs, without wiping the module):

```bash
make e2e-smoke-setup
E2E_SUITE=p0 make e2e-smoke-test
```

Full stack in one command: `E2E_SUITE=p0 make e2e-smoke`. See [`frontend/web/tests/e2e/README.md`](../frontend/web/tests/e2e/README.md).

Default CI (`ci.yml`) only validates that Playwright tests compile (`playwright test --list`); **E2E smoke** is the browser gate.

### 7.2 Pilot golden path (pre-pilot sign-off)

Run before declaring the stack pilot-ready:

```bash
# From repo root — fresh local DB, both MVP golden paths
E2E_CLEAR_DB=1 make e2e-mvp-golden
```

This target ([`Makefile`](../Makefile) `e2e-mvp-golden`):

1. Runs `e2e-smoke-setup` (local SpacetimeDB, publish with `--clear-database`, domain test reducers, `seed_dev_data`, `seed-test-user`, api-server).
2. Runs `mvp-lead-to-cash.spec.ts` (CRM → cash, audit trail).
3. Runs `mvp-procure-to-pay.spec.ts` (PO → bill).

**Specs:** [`frontend/web/tests/e2e/mvp-lead-to-cash.spec.ts`](../frontend/web/tests/e2e/mvp-lead-to-cash.spec.ts), [`frontend/web/tests/e2e/mvp-procure-to-pay.spec.ts`](../frontend/web/tests/e2e/mvp-procure-to-pay.spec.ts).

**Notes:**

- Uses local module `lumiere-v1-local-e2e` (`E2E_STDB_MODULE`), not maincloud.
- `E2E_CLEAR_DB=1` forces `spacetime publish … --clear-database` (see `e2e-smoke-setup` in Makefile).

**Pass criteria:** both golden specs green, no setup failures in `.tmp/e2e/*.log`.

---

## Quick reference

| Task | Command / path |
|------|----------------|
| Validate prod env | `make check-env-prod` |
| Publish maincloud | `make publish-cloud` |
| Start compose stack | `docker compose up --build` |
| Bootstrap tenant | `/onboarding` → `POST /api/bootstrap/tenant` |
| Invite user | Settings → Users → Invite → `/api/auth/invite` |
| api-server health | `:8082/health` |
| AI health | `/api/ai/health` |
| STDB logs (cloud) | `make logs-cloud` |
| Backup drill | `./scripts/backup-stdb.sh $STDB_MODULE maincloud` |
| Tenant export (superuser) | `POST /v1/admin/organizations/{id}/export` (§3.4) |
| CI P0 smoke (PR gate) | `E2E smoke` workflow → `make e2e-smoke-setup && E2E_SUITE=p0 make e2e-smoke-test` |
| Pilot gate | `E2E_CLEAR_DB=1 make e2e-mvp-golden` |
