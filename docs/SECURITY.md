# Security operations

## Auth rate limiting

The Kong gateway uses PostgreSQL-backed shared counters (`policy: cluster`)
with `fault_tolerant: false`. See [gateway setup and fencing](PRODUCTION_DEPLOY.md#gateway-counters-and-ingress-fencing).
Production must expose only the gateway and keep the counter database isolated
from the ERP database. The Railway manifest uses shared per-service quotas and
loopback-only proxy trust because no verified ingress CIDR list is available.
Per-client quotas require verified trusted-proxy/client-IP handling. Limits can be
bypassed if `web` retains a public domain. CORS, robots instructions, and scanner
path rejection do not replace authentication, authorization, or network fencing.

Configuration inspection on 2026-10-28 found both `api-gateway` and `web` public
in Railway's `reasonable-optimism` production environment. The other 15 services
had no HTTP domains or public TCP proxies. Redis and four obsolete gateway
`REDIS_UPSTREAM_*` variables were still provisioned. Gateway logs showed rotating
`100.64.0.*` proxy addresses; trusted-client-IP settings were not configured.
Remove the direct web ingress and verify real-client attribution before treating
IP limits as effective. The PostgreSQL gateway changes in this checkout do not
themselves update those Railway resources.

Qdrant had no API-key variables, and the Chromium renderer accepted internal
requests without a service credential. These services were not publicly exposed,
but shared private networking alone does not provide authentication between
services. Renderer egress restrictions, request authentication, request-size and
concurrency bounds, vector-store credentials, upstream WAF/DDoS rules, and
end-to-end authorization tests remain separate work. This configuration review
does not establish that malicious traffic is comprehensively prevented.

Kong limits `/api/auth/signin`, invite/accept-invite, forgot-password and
reset-password to 10 requests per minute and 100 per hour per client IP.
Public `/api/auth/signup` is rejected at the gateway. Local development that
bypasses Kong does not receive these ingress limits.

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
- api-server readiness: `GET /health/ready` (PostgreSQL and SpacetimeDB; AI is informational)
- ai-gateway readiness: `GET /health/ready` on the gateway (SpacetimeDB, primary Qdrant, provider configuration, Ollama metadata, and any explicit Kong readiness endpoint)

`/health` is liveness only. AI gateway failures never gate ordinary ERP readiness;
AI health is reported independently from the core STDB and PostgreSQL readiness path.
- Metrics: `GET /metrics` (Prometheus text)

## Related

- [PILOT_RUNBOOK.md](./PILOT_RUNBOOK.md)
- [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md)
