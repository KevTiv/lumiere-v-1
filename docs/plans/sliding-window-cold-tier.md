# Sliding-window hot/cold storage tier (SpacetimeDB → Postgres)

**Status:** Proposed — 2026-08-17 (refined)
**Author:** Architecture planning
**Tracks:** `storage-tier`, `horizontal-scaling-investigation`
**Related:** [ARCHITECTURE.md](../ARCHITECTURE.md) · [PRODUCTION_DEPLOY.md](../PRODUCTION_DEPLOY.md) · [PILOT_RUNBOOK.md](../PILOT_RUNBOOK.md)

---

## 1. Problem statement

Alpha testers will onboard with **multi-year POS and order history**. SpacetimeDB holds all
live data in memory with a commit-log WAL; there is no page-to-disk cold path. A single
tenant migrating from another ERP with 5–10 years of `pos_order`, `pos_order_line`,
`sale_order`, `stock_move`, and `account_move` rows can carry millions of historical
records — far exceeding a comfortable in-memory working set and inflating commit-log
replay time on restart.

The **sliding window** keeps recent/active data in SpacetimeDB (the hot, realtime,
transactional tier) and evicts closed/historical data to Postgres (the cold, durable,
disk-backed tier). The frontend is **untouched**: it continues to call
`GET /api/query/:resource`, and the api-server transparently fans out to both tiers in
parallel, merging the results before returning.

### Design constraints (from product/architecture discussion)

1. **Frontend hooks remain untouched.** No hook signature, query key, or `apiFetch`
   call changes. The frontend must not "front the cost" of the tier split.
2. **Backend provisions cold data in parallel.** Cold reads resolve independently and
   merge; a slow Postgres query does not block the hot response.
3. **Writes stay in SpacetimeDB only.** Reducers remain the single transactional write
   path. Postgres is append-only for evicted rows — never a write target from the app.
4. **Eviction is a background worker**, not a reducer. Reducers cannot do network I/O
   (SpacetimeDB determinism); the eviction worker lives in api-server.
5. **AI agents can tackle eviction.** The eviction job surface is designed so an AI
   agent (via the existing action-draft / skill harness) can inspect, prioritize, and
   trigger archival — not just a dumb cron.
6. **Postgres is a generated projection, not a hand-maintained schema.** Cold-tier DDL,
   eviction predicates, and merge queries are emitted by the existing `lumiere-codegen`
   pipeline from SpacetimeDB table definitions. No human writes PG DDL by hand.
7. **SpacetimeDB remains the driving engineering and business engine.** Postgres decides
   nothing about eviction eligibility; it holds evicted rows and manages its own
   internals only.

---

## 2. Architecture

### 2.0 Design principles (refined)

Two refinements to the original plan, both confirmed feasible against the current
schema. They address the core tension: eviction eligibility is a business-logic
decision, but the eviction worker should not re-derive business rules at query time.

#### Refinement 1 — Deterministic eviction indicators on the tables

Instead of the eviction worker re-deriving business rules at query time ("is this
period closed?") via expensive cross-store lookups, each archive-eligible table gains a
denormalized `cold_eligible_at: Option<Timestamp>` column. Reducer logic sets this field
when the row reaches a terminal/immutable state — **the business engine decides
eligibility at write time, not the eviction worker at read time.** The worker filters
on a single deterministic column:

```sql
SELECT id FROM <table>
WHERE organization_id = ?
  AND cold_eligible_at IS NOT NULL
  AND cold_eligible_at < now() - interval ':window'
```

This is critical for `account_move`: the table has no `period_id` column, and resolving
whether a move's fiscal period is closed requires a date-range join against
`account_period` (the `ensure_accounting_period_open_for_date` helper in
`spacetimedb/src/accounting/fiscal_periods.rs:843`). By stamping `cold_eligible_at`
at the moment the period-close reducer runs (it already knows the state transition),
the worker never needs to re-derive period state.

#### Refinement 2 — Helper-function fallback for late-mutated evicted rows

If a row was already evicted to PG but business logic later needs to mutate it (e.g., a
late credit note on an archived `account_move`, a return against an archived
`sale_order`, or a correction on an archived `stock_move`), a SpacetimeDB helper
detects the row is absent from STDB, re-hydrates it from PG, applies the update inside
the reducer transaction, and re-marks it for eviction. The frontend and calling
reducers never know the row was ever cold. See §2.5 for the full mechanism.

```
                         Frontend (UNCHANGED)
                         ┌─────────────────────────────────┐
                         │ useQuery / fetchQueryList       │
                         │   → GET /api/query/:resource    │
                         │ useStdbCallMutation             │
                         │   → POST /api/call/:reducer      │
                         │ realtime subscription (WS)      │
                         └────────────┬────────────────────┘
                                      │ (one HTTP call, unchanged)
                                      ▼
                         ┌─────────────────────────────────┐
                         │       api-server                │
                         │  query_exec.rs  ← THE SEAM      │
                         │                                 │
                         │  for archive-eligible resource: │
                         │    1. fan out in parallel:      │
                         │       • STDB (hot, age < W)     │
                         │       • PG   (cold, age >= W)   │
                         │    2. merge + dedupe by PK       │
                         │    3. return unified row set     │
                         │                                 │
                         │  for non-eligible resource:      │
                         │    STDB only (no behavior change)│
                         └──────┬──────────────┬───────────┘
                                │              │
                   hot (age < W)│              │ cold (age >= W)
                                ▼              ▼
              ┌──────────────────────┐  ┌──────────────────────┐
              │   SpacetimeDB        │  │   Postgres            │
              │   (in-memory + WAL)  │  │   (generated schema,  │
              │                      │  │    read-only mirror)  │
              │   HOT:               │  │   COLD:               │
              │   - open orders      │  │   - archived orders   │
              │   - current period   │  │   - closed periods    │
              │   - active sessions  │  │   - historical audit  │
              │   - ATP / live stock  │  │   - old stock moves   │
              │                      │  │   - re-hydration src   │
              │   cold_eligible_at   │  │                        │
              │   stamped by reducers│  │   (decides nothing;    │
              │                      │  │    holds evicted rows)  │
              └──────────┬───────────┘  └──────────┬───────────┘
                         │                         │
            reducers stamp           eviction worker (api-server bin)
            cold_eligible_at          reads cold_eligible_at rows,
            at terminal state         INSERTs into PG, verify, DELETE
                                      re-hydrates via procedure fallback
```

### 2.1 The seam: `api-server/src/query_exec.rs`

Today, every `GET /api/query/:resource` flows through `query_exec.rs`, which builds
org-scoped SQL via `stdb-auth` (`select_org_scoped_sql` / `select_company_scoped_sql`)
and executes it against SpacetimeDB HTTP SQL. This is the **single routing point** —
no frontend or reducer change is needed to intercept here.

**Change:** for resources in the archive-eligible set (§2.3), `query_exec.rs` will:

1. Issue the SpacetimeDB query (hot) with an injected
   `AND cold_eligible_at IS NULL OR cold_eligible_at >= now() - W` predicate, **and** in
   parallel issue a Postgres query for the same resource scoped
   `WHERE organization_id = ? AND cold_eligible_at < now() - W`.
2. Merge the two row sets, deduplicate by primary key (defensive — the window boundary
   is exclusive), apply existing post-filters (`row_not_soft_deleted`,
   `row_not_archived`, field-access masking), and return.

Non-eligible resources bypass this path entirely — zero behavior change.

### 2.2 Parallel resolution contract

The api-server fans out both queries concurrently (`tokio::join!` or
`FuturesUnordered`). The merge semantics:

| Scenario | Behavior |
|---|---|
| Both succeed | Merge, dedupe by PK, return. |
| Hot succeeds, cold errors/times out | Return hot rows + log cold failure to `/metrics` (counter) and `tracing::warn`. **Do not fail the request** — cold is best-effort for the first release. |
| Hot errors | Return 500 (hot is authoritative for live data). |
| Cold returns rows, hot returns none | Return cold rows (historical-only view). |

**Cold query timeout:** default 3s, configurable via `COLD_TIER_QUERY_TIMEOUT_SECS`.
A slow cold tier must never make the app feel slower than the hot-only baseline —
degrade to hot-only rather than blocking.

### 2.3 Archive-eligible resources and eviction indicators

Each archive-eligible table gains a `cold_eligible_at: Option<Timestamp>` column;
reducer logic sets it when the row reaches a terminal/immutable state.

| Resource | STDB table | `cold_eligible_at` set when | Window `W` | Notes |
|---|---|---|---|---|
| `pos-order` | `pos_order` | `state` transitions to `paid`/`invoiced`/`cancelled` | 90d | Highest-volume table for POS tenants |
| `pos-order-line` | `pos_order_line` | parent `pos_order` marked eligible | 90d | Cascaded from parent |
| `pos-payment` | `pos_payment` | parent `pos_order` marked eligible | 90d | Cascaded from parent |
| `sale-order` | `sale_order` | `state` transitions to `done`/`cancel` | 90d | |
| `sale-order-line` | `sale_order_line` | parent `sale_order` marked eligible | 90d | Cascaded from parent |
| `stock-move` | `stock_move` | `state` becomes `done` | 90d | |
| `account-move` | `account_move` | `state = posted` AND period is closed | 90d | **Period-closed check done by reducer** — see §2.5 |
| `account-move-line` | `account_move_line` | parent `account_move` marked eligible | 90d | Cascaded from parent |
| `audit-log` | `audit_log` | row created (immediately eligible) | 365d | Set at insert; window gates eviction timing |

**Why `cold_eligible_at` instead of re-deriving at query time:** the `account_move`
table has no `period_id` column — resolving whether a move's fiscal period is closed
requires a join against `account_period` filtered by date range (the
`ensure_accounting_period_open_for_date` helper in
`spacetimedb/src/accounting/fiscal_periods.rs:843`). If the eviction worker had to
re-derive this, it would need an N+1 cross-store lookup per batch. By stamping
`cold_eligible_at` at the moment the period closes (via the existing period-close
reducer that already knows the state transition), the worker filters on a single
deterministic column.

**Window `W` (default):** 90 days for transactional tables, 365 days for `audit_log`.
Configurable per-organization via `organization_settings` (new field
`cold_tier_window_days`, default `null` → use global default).

**Excluded (for now):** `pos_session`, `sale_order` quotes/drafts (active workflow),
anything in `core/` (auth, org, permissions), `product`/`contact` masters (small,
frequently referenced, must stay in realtime cache), `account_account`/`account_journal`
(chart of accounts — referenced by every move).

### 2.4 Postgres schema (generated projection — see §2.6)

The cold schema is a **read-optimized mirror**, not a normalized relational model. Each
archived table becomes a PG table with:

- The same columns as the SpacetimeDB row (serialized as JSONB for `Option`/`Vec` fields,
  scalar columns for indexed fields).
- Primary key = the SpacetimeDB `id` (u64 → `BIGINT`).
- `(organization_id, cold_eligible_at)` composite index for the merge query.
- `archived_at TIMESTAMPTZ NOT NULL DEFAULT now()` for provenance.

Schema lives in `api-server/migrations/cold_tier/` as versioned SQL files, applied by
the eviction worker on startup (idempotent `CREATE TABLE IF NOT EXISTS`).

### 2.5 Helper-function fallback for late-mutated evicted rows

A row that was evicted to Postgres may later need mutation by business logic — a late
credit note on an archived `account_move`, a return against an archived `sale_order`,
or a correction on an archived `stock_move`. Since reducers cannot do network I/O
(SpacetimeDB determinism), the re-hydration path uses a SpacetimeDB **procedure**
(procedures can make HTTP requests; reducers cannot):

```
Reducer needs to update row X (by id)
  │
  ▼
ctx.db.<table>().id().find(&x_id)  →  None  (row was evicted)
  │
  ▼
Helper: ensure_row_hydrated(ctx, table, id)
  │  (delegates to a PROCEDURE — procedures can do HTTP, reducers cannot)
  │
  ▼
Procedure fetches row from PG via api-server internal endpoint:
  GET /v1/cold-tier/row/:table/:id  (superuser/service-token auth)
  │
  ▼
Re-inserts the row into SpacetimeDB (within the reducer transaction)
  │
  ▼
Reducer applies the update normally
  │
  ▼
Reducer clears cold_eligible_at = None  (row is hot again, will re-evict later)
```

**Key design points:**

- The re-hydration uses a SpacetimeDB **procedure** (not a reducer), since procedures
  can make HTTP requests and reducers cannot. The procedure fetches the row from PG
  via the api-server's internal cold-tier read endpoint, re-inserts it into STDB, and
  returns control to the calling reducer.
- The `cold_eligible_at` field is cleared on re-hydration (`None`), so the eviction
  worker won't immediately re-evict it. It will be re-stamped when the row reaches a
  terminal state again.
- PG retains the row (the INSERT was `ON CONFLICT DO NOTHING`); the re-hydration does
  not delete from PG. The next eviction cycle will upsert the updated row. This means
  PG may briefly hold a stale copy — the merge query in `query_exec.rs` dedupes by PK,
  preferring the STDB (hot) row when both exist.
- **Frontend impact: zero.** The reducer call path is unchanged from the frontend's
  perspective. The procedure is an internal implementation detail.

**Which reducers need the fallback:** reducers that mutate archived tables by ID —
primarily `account_move` (credit notes, reversals, period re-open), `sale_order`
(returns, cancellations), and `stock_move` (corrections). The fallback is added as a
thin wrapper at the top of these reducers: `let row = ensure_row_hydrated(ctx, ...)`
instead of `ctx.db.account_move().id().find(...)`. Codegen can emit the wrapper.

### 2.6 Postgres as a generated projection (codegen-driven, never hand-written)

The PG schema, eviction predicates, and merge queries are **programmatically generated**
from the SpacetimeDB table definitions — the same codegen pipeline that already emits
TypeScript bindings and the SQL-column registry. This mirrors the existing
`lumiere-codegen` architecture:

```
SpacetimeDB #[table] definitions (Rust, source of truth)
        │
        ▼  spacetime generate
Generated TS table types (column names + types as metadata)
        │
        ▼  lumiere-codegen (cargo run -p lumiere-codegen)
  ├── registry_emit.rs        (existing — query-registry.ts)
  ├── sql_columns_emit.rs      (existing — stdb-generated-sql-columns.json)
  ├── stdb_invalidation_emit.rs (existing — reducer invalidation manifest)
  └── pg_schema_emit.rs       (NEW — cold-tier DDL + eviction predicates)
        │
        ▼  make check-codegen (CI gate — fails if generated artifacts drift)
Cold-tier PG DDL + eviction SQL + merge query templates
```

**Source of truth:** SpacetimeDB Rust `#[table]` definitions. Postgres is a generated
projection — same discipline as TS bindings ("DO NOT edit generated bindings —
regenerate with `spacetime generate`"). No human writes or maintains PG DDL by hand.

**Type mapping (mechanical, from generated metadata):**

| SpacetimeDB type | Postgres type | Notes |
|---|---|---|
| `u64` / `i64` | `BIGINT` | Primary keys, IDs |
| `String` | `TEXT` | |
| `bool` | `BOOLEAN` | |
| `f64` | `DOUBLE PRECISION` | |
| `Timestamp` | `TIMESTAMPTZ` | |
| `Option<T>` | column is `NULL`-able | |
| `Vec<T>` | `JSONB` | Arrays/vecs → JSON (read-optimized) |
| `Identity` | `TEXT` (hex) | Matches api-server serialization |
| Custom enums/structs | `JSONB` | Same serialization as TS bindings |

### 2.7 Scheduling: SpacetimeDB decides eligibility; api-server worker executes

Postgres does **not** drive the eviction cron. The eviction *decision* requires
SpacetimeDB business logic (especially the period-closed check for `account_move`,
now denormalized into `cold_eligible_at` but still set by a reducer). The separation:

| Layer | Role |
|---|---|
| SpacetimeDB reducers | Set `cold_eligible_at` when a row reaches terminal state (the engine decides eligibility) |
| api-server cold-tier worker | Poll STDB for `cold_eligible_at IS NOT NULL AND cold_eligible_at < now() - W`, move rows to PG, verify, delete from STDB (the executor) |
| Postgres | Holds evicted rows; manages its own internals (`VACUUM`, partitioning); decides nothing about eviction |

Postgres may run `pg_cron` for **its own internal maintenance** only (`VACUUM ANALYZE`,
monthly partition creation) — never for eviction decisions, since those require
STDB business logic.

---

## 3. Eviction job

### 3.1 Worker location and Postgres client dependency

The eviction worker is a **standalone api-server binary** — `api-server/src/bin/cold-tier-worker.rs`
→ `run_cold_tier_worker()` — mirroring the five existing worker binaries
(`owner-report-worker`, `expense-integration-worker`, `hr-integration-worker`,
`project-integration-worker`, `workflow-worker`). This reuses the established pattern:
poll a SpacetimeDB queue/indicator, claim via lease, execute, verify, release.

A new module `api-server/src/cold_tier/` containing:

- `worker.rs` — the background poll loop (long-running `tokio::spawn` task).
- `pg_client.rs` — Postgres connection pool (`tokio-postgres` + `deadpool-postgres`).
- `schema.rs` — cold-tier table DDL + migration runner (generated — see §2.6).
- `config.rs` — `ColdTierConfig` (window, batch size, poll interval, timeouts).
- `hydrate.rs` — the re-hydration endpoint (`GET /v1/cold-tier/row/:table/:id`) called
  by the SpacetimeDB procedure fallback (§2.5).

The worker activates only when `COLD_TIER_ENABLED=true` and a Postgres `DATABASE_URL`
is configured.

#### Postgres client: `tokio-postgres` + `deadpool-postgres` (not `sqlx`)

**Dependency choice:** `tokio-postgres` (async wire-protocol client) paired with
`deadpool-postgres` (connection pooling). Not `sqlx`. Rationale:

1. **No compile-time SQL checking needed.** The cold-tier schema and queries are
   codegen artifacts (`pg_schema_emit.rs`, §2.6). If they drift, `make check-codegen`
   catches it at CI time — `sqlx::query!` macro verification would be redundant and
   would require a live database (or `sqlx-data.json`) during `cargo build`.
2. **Minimal dependency surface.** `tokio-postgres` is a thin async wrapper over the
   PostgreSQL wire protocol — no proc-macros, no schema.rs, no ORM overhead. The
   cold-tier query patterns are simple (single-table SELECT by PK, batch INSERT with
   ON CONFLICT). No query builder needed.
3. **Matches the existing tokio stack.** The workspace already uses
   `tokio = { version = "1", features = ["full"] }` and `reqwest`. `tokio-postgres`
   integrates natively with the same runtime.
4. **Faster compile times.** The workspace is large (624 reducers, 6 api-server
   binaries). `sqlx` macros significantly increase compile times; `tokio-postgres`
   adds negligible overhead.

**Cargo.toml addition:**

```toml
# api-server/Cargo.toml
[dependencies]
tokio-postgres = { version = "0.7", features = ["with-chrono-0_4"] }
deadpool-postgres = "0.14"
```

Note: `tokio-postgres` uses `rustls` (not OpenSSL) when configured with the
`rustls` feature, matching the workspace's existing `reqwest` TLS configuration.
This avoids the `pkg-config` / `libssl-dev` build dependency that broke the
sandbox `cargo check` during the readiness assessment.

#### Connection pool setup (`pg_client.rs`)

```rust
use deadpool_postgres::{Config, Pool, Runtime};
use tokio_postgres::NoTls;

pub struct ColdTierPg {
    pub pool: Pool,
}

impl ColdTierPg {
    pub fn from_url(database_url: &str) -> anyhow::Result<Self> {
        let mut cfg = Config::new();
        cfg.url = Some(database_url);
        let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;
        Ok(Self { pool })
    }
}
```

#### Merge-path query example (`query_exec.rs` integration)

When `query_exec.rs` fans out to the cold tier for an archive-eligible resource,
it runs a parameterized query against the PG pool:

```rust
use tokio_postgres::types::Type;

pub async fn cold_tier_read(
    pg: &ColdTierPg,
    table: &str,          // e.g. "cold_pos_order"
    org_id: i64,
    window_days: i32,
) -> Result<Vec<serde_json::Value>, ColdTierError> {
    let client = pg.pool.get().await?;
    let sql = format!(
        "SELECT row_to_json(t) FROM {} t \
         WHERE t.organization_id = $1 \
           AND t.cold_eligible_at IS NOT NULL \
           AND t.cold_eligible_at < now() - ($2 || ' days')::interval",
        table  // table name is from the generated resource registry, not user input
    );
    let rows = client.query(&sql, &[&org_id, &window_days.to_string()])
        .await
        .map_err(|e| ColdTierError::Query(e))?;

    Ok(rows.iter()
        .map(|row| row.get::<_, serde_json::Value>(0))
        .collect())
}
```

The returned JSON values are merged with the SpacetimeDB hot rows in `query_exec.rs`,
deduped by primary key (preferring the STDB row when both exist), and returned to the
caller. The frontend sees a unified row set — no knowledge of the tier split.

#### Eviction INSERT example (`worker.rs` integration)

The eviction worker batch-inserts evicted rows into PG:

```rust
pub async fn cold_tier_insert_batch(
    pg: &ColdTierPg,
    table: &str,
    rows: &[serde_json::Value],
) -> Result<u64, ColdTierError> {
    let client = pg.pool.get().await?;
    let mut count = 0u64;
    for row in rows {
        // Each row is a JSONB blob matching the generated table's column set.
        // ON CONFLICT DO NOTHING — idempotent re-runs after crash recovery.
        let sql = format!(
            "INSERT INTO {} (id, organization_id, cold_eligible_at, row_data, archived_at) \
             VALUES ($1, $2, $3, $4, now()) \
             ON CONFLICT (id) DO NOTHING",
            table
        );
        let id: i64 = row["id"].as_i64().unwrap_or(0);
        let org_id: i64 = row["organization_id"].as_i64().unwrap_or(0);
        let cold_eligible_at: &str = row["cold_eligible_at"]
            .as_str()
            .unwrap_or("1970-01-01T00:00:00Z");
        let row_data = serde_json::to_value(row).unwrap_or(serde_json::Value::Null);

        let result = client.execute(&sql, &[&id, &org_id, &cold_eligible_at, &row_data]).await?;
        count += result;
    }
    Ok(count)
}
```

After the INSERT is verified (returned count matches batch size), the worker
DELETEs the rows from SpacetimeDB. If the worker crashes before the DELETE, the
next run re-fetches and re-inserts (idempotent `ON CONFLICT DO NOTHING`).

### 3.2 Eviction loop

```
loop:
  sleep(poll_interval)  # default 5 min

  for each archive-eligible resource:
    1. Query SpacetimeDB HTTP SQL:
       SELECT id FROM <table>
       WHERE organization_id = ?
         AND cold_eligible_at IS NOT NULL
         AND cold_eligible_at < now() - interval ':window'
       LIMIT batch_size        # default 500

    2. For each batch:
       a. Fetch full rows from SpacetimeDB (SELECT * WHERE id IN (...))
       b. Transform → PG row format (JSONB for complex fields)
       c. INSERT INTO pg_table ... ON CONFLICT (id) DO NOTHING
       d. Verify PG row count == batch count
       e. DELETE FROM stdb_table WHERE id IN (...)   # only after verified insert

    3. Log: resource, org_id, rows_archived, duration
    4. Update /metrics: cold_tier_evicted_total{resource} += n
```

**Critical safety: the DELETE in step (e) only fires after the PG INSERT is verified.**
If the worker crashes mid-batch, the next run re-fetches the same rows (idempotent
`ON CONFLICT DO NOTHING`) and completes the eviction. No data loss window.

### 3.3 AI-agent addressable eviction

The eviction surface is designed for AI-agent inspection and triggering, not just dumb
cron. This builds on the existing `ai-gateway` action-draft harness:

| Capability | How |
|---|---|
| **Inspect backlog** | `GET /v1/cold-tier/backlog` → per-org, per-resource row counts eligible for eviction (reads SpacetimeDB counts via `cold_eligible_at`). |
| **Trigger eviction** | `POST /v1/cold-tier/evict` with `{organization_id, resource?, batch_size?}` → enqueues a one-shot eviction job. |
| **Dry-run preview** | `POST /v1/cold-tier/evict` with `{dry_run: true}` → returns the row IDs that *would* be evicted, no mutation. |
| **Status** | `GET /v1/cold-tier/status` → last run, rows archived, errors, PG connection health. |
| **Re-hydrate row** | `GET /v1/cold-tier/row/:table/:id` → internal endpoint called by the SpacetimeDB procedure fallback (§2.5). Service-token auth only. |

These are **superuser-only** routes (same `is_superuser` guard as
`/v1/admin/organizations/{id}/export`), except the re-hydrate endpoint which is
service-token-only. An AI action-draft can call `/v1/cold-tier/backlog`, surface "Org 3
has 2.1M archived POS orders consuming ~800MB in-memory," and propose an eviction — a
human approves, the draft executes the `POST /v1/cold-tier/evict` call. This keeps the
AI-as-copilot pattern (`V1_ROADMAP.md`) intact for the storage tier.

---

## 4. Frontend impact: zero

This is the central design constraint and it is achievable because of the existing
architecture:

| Frontend surface | Change required |
|---|---|
| `useQuery` / `useStdbCallMutation` hooks | **None.** Query keys and fetch paths unchanged. |
| `fetchQueryList` / `apiFetch` (`api-client`) | **None.** Still `GET /api/query/:resource`. |
| Realtime subscription bridge (`/v1/realtime/ws`) | **None.** Subscriptions stay SpacetimeDB-only. Cold data is read-on-demand, not pushed. |
| `useStdbCallMutation` invalidation manifest | **None.** Mutations still hit SpacetimeDB reducers; the reducer-invalidation manifest (`stdb-reducer-invalidation.ts`) is unchanged. The helper-function fallback (§2.5) is internal to the reducer layer. |
| TanStack Query cache | **None.** The api-server returns a merged row set indistinguishable from a single-store response. |
| RSC `serverFetchQueryList` | **None.** Same `/v1/query/:resource` call. |

The frontend "does not front the cost of the update" — the parallel fan-out and merge
happen entirely in the api-server. A slow cold query degrades to hot-only silently; the
frontend sees a fast partial result, not a loading state.

The helper-function fallback (§2.5) for late-mutated evicted rows is also frontend-
invisible: the reducer call path (`POST /api/call/:reducer`) is unchanged. The
re-hydration via procedure is an internal implementation detail.

**One caveat for transparency:** if a user scrolls to a historical view that's
predominantly cold data and the cold tier is slow, they see the hot rows first (fast)
then the historical rows appear on a re-fetch (TanStack Query refetch). This is the
existing stale-while-revalidate behavior — no new UX pattern.

---

## 5. Implementation phases

### Phase 1 — Cold-tier foundation (no eviction yet)

**Goal:** Postgres connection, generated schema, and the parallel-read merge in
`query_exec.rs` for one resource (`audit-log`). No eviction; PG starts empty.

- [ ] Add `tokio-postgres` + `deadpool-postgres` to `api-server/Cargo.toml`.
- [ ] `api-server/src/cold_tier/mod.rs`, `pg_client.rs`, `config.rs`.
- [ ] `ColdTierConfig::from_env()`: `COLD_TIER_ENABLED`, `DATABASE_URL`,
      `COLD_TIER_WINDOW_DAYS`, `COLD_TIER_QUERY_TIMEOUT_SECS`.
- [ ] Add `pg_schema_emit.rs` to `lumiere-codegen` — emits cold-tier DDL from
      `stdb-generated-sql-columns.json` + the type-mapping table (§2.6).
- [ ] Cold schema migration runner: applies generated `CREATE TABLE IF NOT EXISTS`.
- [ ] Add `cold_eligible_at: Option<Timestamp>` to `audit_log` table; stamp at insert.
- [ ] `query_exec.rs`: for `audit-log` resource, fan out STDB + PG in parallel, merge.
- [ ] `/metrics`: add `cold_tier_cold_reads_total`, `cold_tier_cold_read_errors_total`,
      `cold_tier_merge_duration_seconds`.
- [ ] Integration test: STDB has recent rows, PG has old rows, `GET /api/query/audit-log`
      returns both merged; PG down → returns STDB rows only + warning log.
- [ ] `make check-codegen` extended to validate cold-tier DDL drift.

**Exit gate:** `audit-log` reads transparently merge; no frontend change; PG-down
degrades gracefully; codegen emits cold-tier schema.

### Phase 2 — Eviction worker + remaining resources + `cold_eligible_at`

**Goal:** Background eviction for the full archive-eligible set, with deterministic
indicators.

- [ ] `api-server/src/bin/cold-tier-worker.rs` + `api-server/src/cold_tier/worker.rs`:
      poll loop, batch fetch/insert/verify/delete (mirrors `workflow-worker.rs`).
- [ ] Add `cold_eligible_at: Option<Timestamp>` to: `pos_order`, `pos_order_line`,
      `pos_payment`, `sale_order`, `sale_order_line`, `stock_move`, `account_move`,
      `account_move_line`.
- [ ] Reducer changes to stamp `cold_eligible_at` at terminal state transitions:
      - `pos_order`: `state` → `paid`/`invoiced`/`cancelled`
      - `sale_order`: `state` → `done`/`cancel`
      - `stock_move`: `state` → `done`
      - `account_move`: `state = posted` AND period-close reducer stamps the move
      - child tables: cascaded from parent
- [ ] Cold schema (generated) for all archive-eligible tables.
- [ ] `query_exec.rs`: extend parallel fan-out to all archive-eligible resources.
- [ ] `docker-compose.dev.yml` + `docker-compose.yml`: add `postgres` service +
      `cold-tier-data` volume; wire `DATABASE_URL` into api-server.
- [ ] `scripts/check-prod-env.sh`: require `DATABASE_URL` when `COLD_TIER_ENABLED=true`.
- [ ] `docs/ENVIRONMENT.md`: document cold-tier env vars.
- [ ] `docs/PRODUCTION_DEPLOY.md`: cold-tier deploy notes.

**Exit gate:** eviction worker archives `cold_eligible_at`-stamped rows for all
eligible resources; `GET /api/query/pos-order` returns merged hot+cold transparently;
deleting from STDB only after verified PG insert (crash-safe).

### Phase 3 — Helper-function fallback + AI-agent surface + observability

**Goal:** Late-mutated evicted rows re-hydrate transparently; AI action-drafts can
inspect and trigger eviction; ops has full visibility.

- [ ] `GET /v1/cold-tier/row/:table/:id` (service-token) — re-hydration endpoint.
- [ ] SpacetimeDB procedure: `ensure_row_hydrated(table, id)` — fetches from PG,
      re-inserts into STDB, returns to calling reducer (§2.5).
- [ ] Wrap mutation reducers for `account_move`, `sale_order`, `stock_move` with the
      `ensure_row_hydrated` fallback (codegen can emit the wrapper).
- [ ] `GET /v1/cold-tier/backlog` (superuser) — per-org/resource eligible counts.
- [ ] `POST /v1/cold-tier/evict` (superuser) — one-shot eviction with `dry_run` support.
- [ ] `GET /v1/cold-tier/status` (superuser) — last run, errors, PG health.
- [ ] ai-gateway skill: `cold-tier-eviction` skill manifest so an AI agent can propose
      eviction via the existing action-draft flow.
- [ ] `/metrics`: `cold_tier_evicted_total{resource}`, `cold_tier_pg_pool_connections`,
      `cold_tier_eviction_duration_seconds`, `cold_tier_rehydrations_total`.
- [ ] `docs/PILOT_RUNBOOK.md`: cold-tier ops section (backlog inspection, manual
      eviction, PG health, re-hydration).

**Exit gate:** late-mutated evicted rows re-hydrate transparently (no frontend change);
AI agent can inspect backlog and propose eviction via action-draft; human approves;
eviction runs; status observable.

### Phase 4 — Horizontal scaling investigation (research, not implementation)

**Goal:** Document the path to multi-node SpacetimeDB or partitioning, so the cold-tier
decision is made with eyes open about where it leads.

- [ ] Investigate SpacetimeDB commit-log truncation/checkpointing behavior
      (does `--data-dir` WAL grow unboundedly? Does Standalone support log compaction?
      Measure replay time as a function of log size). **This is the gating unknown.**
- [ ] Evaluate per-tenant database sharding (SpacetimeDB recommends one DB per
      room/match — does this apply to per-org ERP isolation? What's the routing layer?).
- [ ] Evaluate read-replica patterns: can a second SpacetimeDB node serve cold reads
      (if replication lands in Standalone), making Postgres unnecessary for the
      read-merge path?
- [ ] Benchmark: at what working-set size does SpacetimeDB in-memory performance
      degrade vs. a Postgres `shared_buffers` cache for the same query?
- [ ] Decision document: cold-tier-to-Postgres vs. SpacetimeDB-native sharding vs.
      Maincloud-for-DB-tier hybrid. Update this plan with the verdict.

**Exit gate:** a written `docs/plans/horizontal-scaling-investigation.md` with a
recommendation and trigger conditions (when to revisit the architecture).

---

## 6. Operational notes

### 6.1 Postgres on Scaleway

- **Recommended:** Scaleway Managed PostgreSQL (RDB) — offloads backups, PITR, HA,
  minor-version patches. The cold tier is read-heavy, append-only, non-transactional
  from the app's perspective — a managed PG is the right operational fit.
- **Self-hosted alternative:** Postgres in Docker on the same Scaleway instance.
  Acceptable for alpha; must run `pg_dump` → Object Storage backups manually.
- The cold PG instance does **not** need to match SpacetimeDB's latency — it serves
  historical reads with a 3s timeout, degrading to hot-only.

### 6.2 Failure modes

| Failure | Impact | Mitigation |
|---|---|---|
| Postgres unreachable | Cold reads fail; hot reads unaffected | Best-effort merge returns hot-only; `/metrics` counter; `tracing::warn` |
| Eviction worker crashes mid-batch | STDB rows not deleted (INSERT verified before DELETE) | Next run re-fetches same rows; idempotent `ON CONFLICT DO NOTHING` |
| Window boundary skew (row evicted, then read races) | Merge dedupes by PK; no duplicate rows | Exclusive boundary (`cold_eligible_at >= now() - W` for hot, `<` for cold); row is in one tier only |
| Cold PG schema drift (new STDB column not in PG) | Eviction INSERT fails on missing column | `pg_schema_emit.rs` runs via `make codegen`; `check-codegen` CI gate fails on drift; migration runner applies additive `ALTER TABLE` on startup |
| Late mutation of evicted row | Row absent from STDB; reducer would fail | Helper-function fallback (§2.5) re-hydrates from PG before mutation |
| Re-hydration fails (PG down during a late mutation) | Reducer returns Err; user sees error | Same as any reducer error; retry on next attempt. Hot data is unaffected. |

### 6.3 Monitoring

| Metric | Type | Purpose |
|---|---|---|
| `cold_tier_cold_reads_total` | counter | Cold read fan-outs attempted |
| `cold_tier_cold_read_errors_total` | counter | Cold read failures (degraded to hot) |
| `cold_tier_merge_duration_seconds` | histogram | End-to-end merge latency |
| `cold_tier_evicted_total{resource}` | counter | Rows archived to PG |
| `cold_tier_eviction_duration_seconds` | histogram | Eviction batch latency |
| `cold_tier_pg_pool_connections` | gauge | PG pool health |
| `cold_tier_backlog_rows{resource}` | gauge | Eligible-but-not-yet-evicted rows (from backlog endpoint) |
| `cold_tier_rehydrations_total` | counter | Late-mutation re-hydrations from PG |

---

## 7. What this does NOT change

- **Reducers** — no reducer's external contract changes. Writes remain 100% SpacetimeDB.
  (Internal: mutation reducers gain a thin `ensure_row_hydrated` wrapper for archived
  rows — frontend-invisible.)
- **Realtime subscriptions** — stay SpacetimeDB-only. Cold data is not pushed.
- **Frontend hooks** — zero changes (§4).
- **Audit log write path** — `write_audit_log_v2` still writes to SpacetimeDB; the
  eviction worker moves old rows to PG asynchronously.
- **Financial integrity invariants** — `account_move` is only evicted when
  `cold_eligible_at` is set, which requires `state = posted` AND period closed.
  Open-period moves stay in SpacetimeDB. This preserves all A2/A3/A4 invariants for
  active data. If a period is re-opened, the re-hydration fallback (§2.5) brings the
  row back to STDB.
- **The backup/restore story** — the cold PG instance is backed up independently
  (managed PITR or `pg_dump` → Object Storage). SpacetimeDB backup/restore (the
  block-snapshot + restic approach) remains as documented; it now backs up a smaller
  hot working set, which is faster and cheaper.

---


1. **SpacetimeDB commit-log truncation:** ~~does Standalone compact/truncate the WAL, or
   does it grow forever?~~ **Resolved (2026-08-17):** SpacetimeDB has a native
   `spacetimedb-snapshot` crate (v1.3.0, confirmed on docs.rs) that captures on-disk
   snapshots of committed state at a transaction offset. On restart, the database loads
   the most recent snapshot and replays only the commit-log suffix. This means eviction
   (which shrinks the in-memory working set) combined with periodic snapshot capture
   reduces replay time on restart. The commit-log itself is not truncated by snapshots,
   but the replay path is shortened. The standalone `config.toml` now exposes
   `[commitlog]` knobs (`max-segment-size`, `write-buffer-size`, `preallocate-segments`).
   **Action:** enable periodic snapshot capture (see `backup-recovery-followup.md`) and
   measure replay time before/after. No longer a blocker for Phase 2.
2. **Per-org window configurability:** is 90 days right for POS-heavy tenants? A
   high-volume retailer may want 30 days hot; a low-volume B2B may want 365. Default +
   per-org override via `organization_settings.cold_tier_window_days`.
3. **Re-hydration procedure feasibility:** ~~SpacetimeDB 2.0 procedures are documented as
   beta. Verify the procedure can make an HTTP call to the api-server re-hydration
   endpoint and re-insert the row within the calling reducer's transaction.~~
   **Resolved (2026-08-17):** Confirmed feasible via official SpacetimeDB 2.0 docs
   (spacetimedb.com/docs/1.12.0/functions/procedures/). Rust procedures use
   `ProcedureContext` with two key capabilities:
   - `ctx.http.get(url)` / `ctx.http.send(request)` — synchronous HTTP to external
     services (the api-server re-hydration endpoint).
   - `ctx.with_tx(|tx_ctx| { ... })` / `ctx.try_with_tx(|tx_ctx| { ... })` — opens a
     database transaction with full read-write access (same as `ReducerContext`).
   The re-hydration procedure can: (1) make an HTTP GET to
   `/v1/cold-tier/row/:table/:id`, (2) parse the response, (3) call `ctx.with_tx` to
   re-insert the row into STDB, all within a single procedure call. **Caveat:**
   procedures cannot send HTTP requests while holding a transaction open — the HTTP
   call must complete before `with_tx` is entered. This matches our design (fetch from
   PG first, then open transaction to insert). **Requirement:** the `spacetimedb`
   dependency in `spacetimedb/Cargo.toml` must add `features = ["unstable"]` (procedures
   are behind the unstable feature gate in Rust modules). The project currently uses
   `spacetimedb = { version = "2.0.1" }` without the feature — this is a Phase 3
   prerequisite. See `backup-recovery-followup.md` §4 for the verified API.
4. **Horizontal scaling path:** is the cold tier a stepping stone to per-org SpacetimeDB
   sharding, or a permanent second store? Phase 4 investigation answers this.

---

## 9. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-17 | Adopt sliding-window hot/cold tier for alpha | Alpha testers bring multi-year POS/order history; in-memory model can't hold it |
| 2026-08-17 | Postgres (not another SpacetimeDB node) as cold tier | Disk-backed cold storage; managed PG offloads ops; SpacetimeDB Standalone has no replication |
| 2026-08-17 | api-server as the merge seam (not frontend, not reducer) | Single chokepoint at `query_exec.rs`; frontend stays untouched |
| 2026-08-17 | Eviction is a background worker, not a reducer | Reducers can't do network I/O (determinism); worker can verify-then-delete |
| 2026-08-17 | AI-agent-addressable eviction surface | Aligns with AI-as-copilot pattern; backlog inspection + dry-run + human-approved trigger |
| 2026-08-17 | Postgres is a generated projection (codegen-driven) | Same source-of-truth discipline as TS bindings; `pg_schema_emit.rs` in `lumiere-codegen`; `check-codegen` CI gate prevents drift |
| 2026-08-17 | Postgres does not schedule or decide eviction | Eviction eligibility is business logic (period-closed, state-transition); only SpacetimeDB reducers decide; PG holds rows and manages its own internals only |
| 2026-08-17 | Deterministic `cold_eligible_at` indicator on tables | Avoids N+1 cross-store business-logic re-derivation at eviction time; reducer stamps at terminal state, worker filters on one column |
| 2026-08-17 | Helper-function fallback for late-mutated evicted rows | Evicted rows may need mutation (credit notes, returns, corrections); procedure re-hydrates from PG transparently; frontend-invisible |
| 2026-08-17 | Re-hydration via SpacetimeDB procedure (confirmed feasible) | Official docs confirm `ctx.http.get()` + `ctx.with_tx()` in Rust procedures; requires `features = ["unstable"]` in Cargo.toml; HTTP must complete before transaction opens |
| 2026-08-17 | Native snapshot capture for backup + replay optimization | `spacetimedb-snapshot` crate (v1.3.0) captures on-disk snapshots at tx offset; restart loads snapshot + replays suffix only; resolves commit-log growth concern |
| 2026-08-17 | `tokio-postgres` + `deadpool-postgres` as PG client (not `sqlx`) | Codegen-driven schema/queries make compile-time SQL checking redundant; thin async client matches existing tokio stack; avoids proc-macro compile overhead; uses rustls not OpenSSL |
