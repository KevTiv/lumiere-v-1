# SpacetimeDB HTTP SQL limitations (Lumiere)

This guide documents SQL features that **SpacetimeDB’s HTTP/SQL interface does not support** (or that we avoid), the symptoms we hit in Lumiere, and how the codebase works around them.

It applies to:

- `**/api/query/...`** — browser reads via api-server `query_exec.rs`; admin routes may use `stdbSql` from `@lumiere/stdb/server`.
- **WebSocket subscription SQL** — queries built in `frontend/packages/stdb/src/queries/erp-subscriptions.ts` and related modules.

Bindings and reducers are unaffected; this is only about **SQL strings** sent over SpacetimeDB’s SQL API.

---

## What fails or is unsafe

### 1. `SELECT *`

**Symptom:** HTTP SQL returns an error (often reported as **Unsupported** or similar) when the query uses a star projection.

**Rule in this repo:** Always project an **explicit column list** in snake_case, aligned with the table schema.

**Implementation:**

- `**resolveHttpSqlColumns(resourceKey, fieldAccess)`** in `frontend/packages/stdb/src/field-policy.ts` — builds the column list for a `QueryResourceKey` (Casbin-restricted columns when applicable, otherwise full list from generated metadata).
- `**sqlColumnListForGeneratedType(typeName)**` — for tables that are not keyed as `QueryResourceKey` (e.g. `SubscriptionLine`, `FormConfig`).
- Generated column metadata: `stdb-generated-sql-columns.json` — run `make codegen` after SpacetimeDB binding changes (parsed from `generated/*_table.ts` + `types.ts`).

Do not add new HTTP or subscription queries that use `SELECT *`.

### 2. `IN (SELECT …)` subqueries

**Symptom:** Same class of **Unsupported** errors when filtering with a subquery, e.g. `WHERE company_id IN (SELECT id FROM company WHERE …)`.

**Reason:** SpacetimeDB SQL (as used here) does not support that pattern the way a full Postgres dialect would.

**Mitigations used in Lumiere:**

1. **Resolve IDs first, then query with a literal list** — e.g. load company ids for the org, then `WHERE company_id IN (1, 2, 3)`. api-server `query_exec.rs` and `company-scope-server.ts` follow this pattern.
2. **Pass `companyIds` from the server into the client** — `RootLayout` loads companies via `serverFetchQueryList('companies')` and passes `companyIds` through `Providers` → `StdbConnectionProvider` → `createClientSubscriptions`, so WebSocket subscriptions for **company-scoped** resources can use `IN (${ids})` without a subquery. Context type: `SubscriptionQueryContext` in `erp-subscriptions.ts`.
3. **Split into multiple round-trips** — e.g. payment terms, then term lines keyed by those ids (see `query_exec.rs` for `account-payment-term-lines`).

### 3. `JOIN` (avoid for HTTP SQL)

**Symptom:** Unsupported or brittle behavior when combining tables in one SQL statement.

**Mitigation:** Prefer **two queries** (parent rows, then child rows with `WHERE … IN (...)` on explicit ids), or a single table query with explicit columns.

---

## Subscription-specific notes

- Resources such as `**fixed-assets`**, `**intercompany-rules**`, and `**intercompany-transactions**` need `**companyIds**` on `SubscriptionQueryContext`. If `companyIds` is missing, subscription SQL for those keys may be omitted (`null`), so the UI will not get live rows until layout/providers supply ids.
- `**depreciation-lines**` is tied to assets; without asset ids, a safe single subscription is not built — handled as `null` in `subscriptionSqlForCompanyScopedResource`.
- `**form-configuration**` subscriptions were reduced to `**form_config**` and `**user_custom_field**` with explicit columns; queries that relied on `IN (SELECT …)` for related tables were removed to satisfy SQL limits.

---

## API route pitfall (fixed pattern)

Browser query routes proxy to api-server `query_exec.rs`. When adding special-case SQL there, match reducer/query parameter order — do not swap optional filter args with `StdbHttpOptions`.

---

## Related files (quick map)


| Area                                | Location                                                         |
| ----------------------------------- | ---------------------------------------------------------------- |
| Column resolution / field policy    | `frontend/packages/stdb/src/field-policy.ts`, `crates/stdb-auth/src/field_policy.rs` |
| SSR list reads (RSC pages)          | `frontend/web/lib/server-query.ts` → api-server `query_exec.rs`  |
| Admin `stdbSql` (auth routes)       | `frontend/packages/stdb/src/server.ts`                           |
| Subscription SQL builders           | `frontend/packages/stdb/src/queries/erp-subscriptions.ts`        |
| Auth / subscription helpers         | `frontend/packages/stdb/src/queries/auth.ts`, `subscriptions.ts` |
| RSC → client `companyIds`           | `frontend/web/app/layout.tsx`, `frontend/web/app/providers.tsx`  |
| WebSocket provider                  | `frontend/packages/stdb/src/context.tsx`                         |
| Query route map                     | `frontend/web/app/api/query/[resource]/route.ts`                 |
| Rust gateway assets + codegen       | `crates/stdb-auth/assets/*.json`, `make codegen` (`lumiere-codegen`) |


---

## When adding a new resource

1. Register `**QueryResourceKey`** / column policy in `field-policy.ts` if the resource is user-facing through `/api/query`.
2. Build SQL with `**resolveHttpSqlColumns**` or `**sqlColumnListForGeneratedType**` — never `*`.
3. Avoid subqueries and JOINs; use **literal `IN` lists** or **extra queries**.
4. If the table is scoped only by `**company_id`**, ensure both **HTTP** paths (server can call `companyIdsForOrganization`) and **WebSocket** paths (pass `**companyIds`** from RSC) are considered.
5. Run `make codegen` after SpacetimeDB schema changes so `resource_registry.json`, `query-resource-row-type.json`, and `stdb-generated-sql-columns.json` stay aligned (Rust assets + frontend copies).

---

## Official references

SpacetimeDB’s supported SQL surface can change; treat this doc as **Lumiere’s** operational record. For upstream behavior, see the current SpacetimeDB documentation for **SQL** and **HTTP API** limits.