# SpacetimeDB HTTP SQL limitations (Lumiere)

This guide documents SQL features that **SpacetimeDB’s HTTP/SQL interface does not support** (or that we avoid), the symptoms we hit in Lumiere, and how the codebase works around them.

It applies to:

- `**/api/query/...`** — server-side queries in `frontend/packages/stdb/src/server.ts` via `stdbSql`.
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
- Generated column metadata: `frontend/packages/stdb/src/stdb-generated-sql-columns.json` (from `generated/types.ts`).

Do not add new HTTP or subscription queries that use `SELECT *`.

### 2. `IN (SELECT …)` subqueries

**Symptom:** Same class of **Unsupported** errors when filtering with a subquery, e.g. `WHERE company_id IN (SELECT id FROM company WHERE …)`.

**Reason:** SpacetimeDB SQL (as used here) does not support that pattern the way a full Postgres dialect would.

**Mitigations used in Lumiere:**

1. **Resolve IDs first, then query with a literal list** — e.g. load company ids for the org, then `WHERE company_id IN (1, 2, 3)`. See `companyIdsForOrganization` and related `serverQuery*` helpers in `server.ts`.
2. **Pass `companyIds` from the server into the client** — `RootLayout` loads companies with `serverQueryCompanies` and passes `companyIds` through `Providers` → `StdbConnectionProvider` → `createClientSubscriptions`, so WebSocket subscriptions for **company-scoped** resources can use `IN (${ids})` without a subquery. Context type: `SubscriptionQueryContext` in `erp-subscriptions.ts`.
3. **Split into multiple round-trips** — e.g. payment terms, then term lines keyed by those ids (see comment on `serverQueryAccountPaymentTermLines`: no JOIN).

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

When wiring `serverQuery*` into `frontend/web/app/api/query/[resource]/route.ts`, match the **real function signature**. For example, `serverQueryAccountMoves(organizationId, moveType?, opts?)` must not pass `opts` in the `moveType` position (that previously caused bogus SQL filters).

---

## Related files (quick map)


| Area                                | Location                                                         |
| ----------------------------------- | ---------------------------------------------------------------- |
| Column resolution / field policy    | `frontend/packages/stdb/src/field-policy.ts`                     |
| HTTP `serverQuery*` implementations | `frontend/packages/stdb/src/server.ts`                           |
| Subscription SQL builders           | `frontend/packages/stdb/src/queries/erp-subscriptions.ts`        |
| Auth / subscription helpers         | `frontend/packages/stdb/src/queries/auth.ts`, `subscriptions.ts` |
| RSC → client `companyIds`           | `frontend/web/app/layout.tsx`, `frontend/web/app/providers.tsx`  |
| WebSocket provider                  | `frontend/packages/stdb/src/context.tsx`                         |
| Query route map                     | `frontend/web/app/api/query/[resource]/route.ts`                 |
| Rust gateway field policy (mirror)  | `crates/stdb-auth/assets/*.json`, `crates/stdb-auth/src/field_policy.rs` |


---

## When adding a new resource

1. Register `**QueryResourceKey`** / column policy in `field-policy.ts` if the resource is user-facing through `/api/query`.
2. Build SQL with `**resolveHttpSqlColumns**` or `**sqlColumnListForGeneratedType**` — never `*`.
3. Avoid subqueries and JOINs; use **literal `IN` lists** or **extra queries**.
4. If the table is scoped only by `**company_id`**, ensure both **HTTP** paths (server can call `companyIdsForOrganization`) and **WebSocket** paths (pass `**companyIds`** from RSC) are considered.
5. If the **Rust** `stdb-auth` / API gateway validates query resources, mirror the same keys in `crates/stdb-auth/assets/resource_registry.json` and `query-resource-row-type.json` (and keep `stdb-generated-sql-columns.json` in sync with the frontend copy). See `crates/stdb-auth/src/field_policy.rs`.

---

## Official references

SpacetimeDB’s supported SQL surface can change; treat this doc as **Lumiere’s** operational record. For upstream behavior, see the current SpacetimeDB documentation for **SQL** and **HTTP API** limits.