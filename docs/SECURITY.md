# Security operations

## Auth rate limiting

Production api-server should sit behind Kong or a reverse proxy with rate limits on:

- `POST /v1/auth/sign-in`
- `POST /v1/auth/sign-up`
- `POST /v1/auth/forgot-password`

Local dev has no in-process limiter yet; use Kong plugins or cloud WAF in production.

## Session policy

- Browser sessions use `stdb_token` + `stdb_identity` cookies (30-day max-age in [api-server/src/routes/auth.rs](../api-server/src/routes/auth.rs)).
- Rotate `STDB_SERVER_TOKEN`, `STDB_FINALIZATION_TOKEN`, and
  `STDB_CREDENTIAL_ENCRYPTION_KEY` on compromise; force password reset for
  affected users.

## Session resolution (api-server)

User-facing `/v1/query/*` and `/v1/call/*` require an authenticated **user session**. Identity is bound to a valid user JWT — not to server-admin tokens or spoofable headers.

| Source | Used for | Notes |
|--------|----------|--------|
| `Authorization: Bearer <jwt>` | Browser / API clients | Primary session token from sign-in |
| `stdb_token` cookie | Browser BFF (`/api/*` → api-server) | Set by auth routes after successful sign-in |
| `STDB_SERVER_TOKEN` | **Server-side only** | HTTP SQL, bootstrap/import routes, credential provisioning — **never** an implicit anonymous session |
| `STDB_FINALIZATION_TOKEN` | **Projection worker only** | Registered service identity for archive-finalizer reducer calls; never grants private commit-table reads |
| `x-stdb-identity` | Logging / hints only | **Not** trusted for access without a matching user JWT |
| `DEV_MOCK_ORG_ID` | Local dev bypass | Ignored when `runtime_is_production()` is true ([api-server/src/config.rs](../api-server/src/config.rs)) |

**Expected behavior:** Requests with no Bearer token and no `stdb_token` cookie receive **401 Unauthorized** from `/v1/query` and `/v1/call`. Do not configure browsers or operators to “fix” 401s by relying on `STDB_SERVER_TOKEN`.

**Verification (operators):**

```bash
rg 'server.token.*fallback|STDB_SERVER_TOKEN.*session' docs/SECURITY.md
rg 'DEV_MOCK' docs/SECURITY.md
rg 'x-stdb-identity' docs/SECURITY.md

curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:8082/v1/query/contacts?organizationId=1"
# Expect: 401 (no cookies / Authorization)
```

Role-level enforcement for financial/inventory reducers (`post_account_move`, `validate_stock_picking`, `post_payment`, etc.) is implemented in the SpacetimeDB module via `check_permission` ([spacetimedb/src/helpers.rs](../spacetimedb/src/helpers.rs)). E2E coverage: [frontend/web/tests/e2e/auth-permission-enforcement.spec.ts](../frontend/web/tests/e2e/auth-permission-enforcement.spec.ts).

## Secrets rotation checklist

1. Generate new `STDB_SERVER_TOKEN` and a distinct finalization-worker token in
   SpacetimeDB, then register the latter identity as `projection_worker`.
2. Update `STDB_SERVER_TOKEN` and `STDB_FINALIZATION_TOKEN` in the host secret
   store and redeploy their consuming services.
3. Rotate `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` across all three services simultaneously.
4. Re-encrypt credentials if `STDB_CREDENTIAL_ENCRYPTION_KEY` changes (users must reset passwords).

## Production reducer allowlist

Strict mode blocks bootstrap, seed, CSV import via generic `/v1/call`, and test reducers. Use dedicated routes:

- Tenant bootstrap: `POST /v1/bootstrap/tenant`
- CSV import: `POST /v1/import/{entity}`

The allowlist is **global** (not per-role). It complements — but does not replace — module-level Casbin / `org_permission` checks inside reducers.

See [api-server/src/reducer_allowlist.rs](../api-server/src/reducer_allowlist.rs).

## Monitoring

- api-server liveness: `GET /health`
- api-server readiness: `GET /health/ready` (PostgreSQL, SpacetimeDB, and configured ai-gateway)
- ai-gateway readiness: `GET /health/ready` on the gateway (SpacetimeDB, primary Qdrant, provider configuration, Ollama metadata, and any explicit Kong readiness endpoint)

`/health` is liveness only. In production `AI_GATEWAY_REQUIRED` defaults to true, so
gateway transport failures and non-success responses make readiness fail. Development
defaults it to false unless explicitly overridden.
- Metrics: `GET /metrics` (Prometheus text)

## Related

- [PILOT_RUNBOOK.md](./PILOT_RUNBOOK.md)
- [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md)
