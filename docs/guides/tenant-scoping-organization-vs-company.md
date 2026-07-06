# Tenant scoping: organization vs company

This project uses two different identifiers. Mixing them breaks isolation or returns the wrong ERP slice.

## `organization_id` (org id)

- **Meaning:** The **tenant** boundary. All authenticated API traffic is ultimately scoped to one organization (via `user_organization`, session resolution, and RBAC).
- **Use for:** HTTP SQL `WHERE organization_id = …`, Casbin `v1`, subscription keys, generic `/v1/query/:resource` when the table row carries `organization_id`, and server-side “which customer is this?” checks.

## `company_id`

- **Meaning:** An **ERP dimension inside an org**: legal entities, branches, customers/suppliers modeled as companies, etc. One organization can own many companies.
- **Use for:** Row fields and reducers that mean “which company within this org,” **not** as a substitute for tenant isolation.

## Rules of thumb

1. **Default API queries** filter on **`organization_id`** unless the resource is explicitly defined as **company-scoped** (e.g. carriers, methods tied to a single company row).
2. Resolving **“default company”** for a tenant (e.g. first active `company` row for that `organization_id`) is a separate step; do not assume `organization_id == company_id`.
3. Some legacy TypeScript query helpers pass a variable named `organizationId` into APIs that build `WHERE company_id = …`. Treat that as a **naming/technical debt** surface: new Rust or refactored TS code should use explicit **company id resolution** where the schema expects `company_id`.

## Related code

- Next.js session: `frontend/web/lib/api-session.ts`
- Org-scoped SQL helpers: `frontend/packages/stdb/src/field-policy.ts` (`selectOrgScopedSql`, `selectCompanyScopedSql`)
- SpacetimeDB HTTP SQL: `frontend/packages/stdb/src/http.ts`
- Rust API (Phase 0–2): `api-server/` — `GET /v1/query/:resource`, `POST /v1/call/:reducer`, and domain routes under `/v1/crm`, `/v1/sales`, etc. use **`organization_id`** for tenant scope where applicable; company-scoped queries resolve **`company_id`** via the default `company` row (see `api-server/src/query_exec.rs`).
- Browser → Rust (Phase 3): set `NEXT_PUBLIC_API_GATEWAY_URL` (e.g. `http://localhost:8082`) so the web app’s `apiFetch` / `fetchQueryList` send whitelisted `/api/*` traffic to `{url}/v1/*` instead of Next.js. Use `CORS_ORIGINS` on `api-server` when the web app runs on another origin. Helpers: `frontend/web/lib/api-url.ts`, `api-fetch.ts`.

## Maintaining the Rust field registry

**Source of truth:** [`crates/stdb-auth/assets/resource_registry.json`](../../crates/stdb-auth/assets/resource_registry.json) (owned by the Rust `stdb-auth` crate).

After editing the registry, regenerate TypeScript:

```bash
make codegen
```

Outputs:

- `frontend/packages/stdb/src/generated/query-registry.ts` — `QueryResourceKey`, `RESOURCE_REGISTRY`
- `frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts` — reducer → query invalidation map

CI runs `make check-codegen` on every PR (fails if generated files drift).

**SSR:** Module `page.tsx` files fetch initial data via `serverFetchQueryListsAllowEmpty` (`frontend/web/lib/server-query.ts`) → api-server `query_exec.rs`, not direct `server.ts` STDB HTTP.

Also keep `query-resource-row-type.json` and `stdb-generated-sql-columns.json` aligned between `frontend/packages/stdb/src/` and `crates/stdb-auth/assets/` when SpacetimeDB schema changes (until those are codegen’d too).
