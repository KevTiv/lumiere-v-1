# Sliding-window hot/cold storage tier (SpacetimeDB → Postgres)

**Status:** Proposed — 2026-08-17
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
4. **Eviction is a background job**, not a reducer. Reducers cannot do network I/O
   (SpacetimeDB determinism); the eviction worker lives in api-server.
5. **AI agents can tackle eviction.** The eviction job surface is designed so an AI
   agent (via the existing action-draft / skill harness) can inspect, prioritize, and
   trigger archival — not just a dumb cron.

---

## 2. Architecture

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
              │   (in-memory + WAL)  │  │   (Scaleway Managed   │
              │                      │  │    or self-hosted)    │
              │   HOT:               │  │   COLD:               │
              │   - open orders      │  │   - archived orders   │
              │   - current period   │  │   - closed periods    │
              │   - active sessions  │  │   - historical audit  │
              │   - ATP / live stock  │  │   - old stock moves   │
              └──────────────────────┘  └──────────┬───────────┘
                                                   │
                                          eviction job (api-server worker)
                                          reads STDB rows age >= W,
                                          INSERTs into PG, DELETEs from STDB
```

### 2.1 The seam: `api-server/src/query_exec.rs`

Today, every `GET /api/query/:resource` flows through `query_exec.rs`, which builds
org-scoped SQL via `stdb-auth` (`select_org_scoped_sql` / `select_company_scoped_sql`)
and executes it against SpacetimeDB HTTP SQL. This is the **single routing point** —
no frontend or reducer change is needed to intercept here.

**Change:** for resources in the archive-eligible set (§2.3), `query_exec.rs` will:

1. Issue the SpacetimeDB query (hot) with an injected `AND created_date >= now() - W`
   predicate, **and** in parallel issue a Postgres query for the same resource scoped
   `WHERE organization_id = ? AND created_date < now() - W`.
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

### 2.3 Archive-eligible resources (initial set)

These are the high-volume, append-mostly, historically-immutable tables that drive
the RAM ceiling. Selected from the existing `resource_registry.json`:

| Resource | STDB table | Archive trigger | Notes |
|---|---|---|---|
| `pos-order` | `pos_order` | `state = paid/invoiced/cancelled AND date_order < W` | Highest-volume table for POS tenants |
| `pos-order-line` | `pos_order_line` | parent `pos_order` archived | Evict with parent (FK integrity) |
| `pos-payment` | `pos_payment` | parent `pos_order` archived | Evict with parent |
| `sale-order` | `sale_order` | `state in (done, cancel) AND date_order < W` | |
| `sale-order-line` | `sale_order_line` | parent `sale_order` archived | Evict with parent |
| `stock-move` | `stock_move` | `state = done AND date < W` | |
| `account-move` | `account_move` | `period state = closed AND date < W` | **Closed fiscal periods only** — never archive open-period moves |
| `account-move-line` | `account_move_line` | parent `account_move` archived | Evict with parent |
| `audit-log` | `audit_log` | `created_at < W` (no state gate) | Highest unbounded growth; 1,089 write sites |

**Window `W` (default):** 90 days for transactional tables, 365 days for `audit_log`.
Configurable per-organization via `organization_settings` (new field
`cold_tier_window_days`, default `null` → use global default).

**Excluded (for now):** `pos_session`, `sale_order` quotes/drafts (active workflow),
anything in `core/` (auth, org, permissions), `product`/`contact` masters (small,
frequently referenced, must stay in realtime cache), `account_account`/`account_journal`
(chart of accounts — referenced by every move).

### 2.4 Postgres schema

The cold schema is a **read-optimized mirror**, not a normalized relational model. Each
archived table becomes a PG table with:

- The same columns as the SpacetimeDB row (serialized as JSONB for `Option`/`Vec` fields,
  scalar columns for indexed fields).
- Primary key = the SpacetimeDB `id` (u64 → `BIGINT`).
- `(organization_id, created_date)` composite index for the merge query.
- `archived_at TIMESTAMPTZ NOT NULL DEFAULT now()` for provenance.

Schema lives in `api-server/migrations/cold_tier/` as versioned SQL files, applied by
the eviction worker on startup (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## 3. Eviction job

### 3.1 Worker location

A new module `api-server/src/cold_tier/` containing:

- `eviction.rs` — the background worker (long-running `tokio::spawn` task).
- `pg_client.rs` — Postgres connection pool (`sqlx` or `deadpool-postgres`).
- `schema.rs` — cold-tier table DDL + migration runner.
- `config.rs` — `ColdTierConfig` (window, batch size, poll interval, timeouts).

The worker runs **inside the api-server process** (not a separate container) to reuse
the existing SpacetimeDB HTTP client, auth, and config. It activates only when
`COLD_TIER_ENABLED=true` and a Postgres `DATABASE_URL` is configured.

### 3.2 Eviction loop

```
loop:
  sleep(poll_interval)  # default 5 min

  for each archive-eligible resource:
    1. Query SpacetimeDB HTTP SQL:
       SELECT id FROM <table>
       WHERE organization_id = ? AND <archive_predicate>
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
| **Inspect backlog** | `GET /v1/cold-tier/backlog` → per-org, per-resource row counts eligible for eviction (reads SpacetimeDB counts). |
| **Trigger eviction** | `POST /v1/cold-tier/evict` with `{organization_id, resource?, batch_size?}` → enqueues a one-shot eviction job. |
| **Dry-run preview** | `POST /v1/cold-tier/evict` with `{dry_run: true}` → returns the row IDs that *would* be evicted, no mutation. |
| **Status** | `GET /v1/cold-tier/status` → last run, rows archived, errors, PG connection health. |

These are **superuser-only** routes (same `is_superuser` guard as
`/v1/admin/organizations/{id}/export`). An AI action-draft can call
`/v1/cold-tier/backlog`, surface "Org 3 has 2.1M archived POS orders consuming ~800MB
in-memory," and propose an eviction — a human approves, the draft executes the
`POST /v1/cold-tier/evict` call. This keeps the AI-as-copilot pattern (`V1_ROADMAP.md`)
intact for the storage tier.

---

## 4. Frontend impact: zero

This is the central design constraint and it is achievable because of the existing
architecture:

| Frontend surface | Change required |
|---|---|
| `useQuery` / `useStdbCallMutation` hooks | **None.** Query keys and fetch paths unchanged. |
| `fetchQueryList` / `apiFetch` (`api-client`) | **None.** Still `GET /api/query/:resource`. |
| Realtime subscription bridge (`/v1/realtime/ws`) | **None.** Subscriptions stay SpacetimeDB-only. Cold data is read-on-demand, not pushed. |
| `useStdbCallMutation` invalidation manifest | **None.** Mutations still hit SpacetimeDB reducers; the reducer-invalidation manifest (`stdb-reducer-invalidation.ts`) is unchanged. |
| TanStack Query cache | **None.** The api-server returns a merged row set indistinguishable from a single-store response. |
| RSC `serverFetchQueryList` | **None.** Same `/v1/query/:resource` call. |

The frontend "does not front the cost of the update" — the parallel fan-out and merge
happen entirely in the api-server. A slow cold query degrades to hot-only silently; the
frontend sees a fast partial result, not a loading state.

**One caveat for transparency:** if a user scrolls to a historical view that's
predominantly cold data and the cold tier is slow, they see the hot rows first (fast)
then the historical rows appear on a re-fetch (TanStack Query refetch). This is the
existing stale-while-revalidate behavior — no new UX pattern.

---

## 5. Implementation phases

### Phase 1 — Cold-tier foundation (no eviction yet)

**Goal:** Postgres connection, schema, and the parallel-read merge in `query_exec.rs`
for one resource (`audit-log`). No eviction; PG starts empty.

- [ ] Add `sqlx` (or `deadpool-postgres`) to `api-server/Cargo.toml`.
- [ ] `api-server/src/cold_tier/mod.rs`, `pg_client.rs`, `config.rs`.
- [ ] `ColdTierConfig::from_env()`: `COLD_TIER_ENABLED`, `DATABASE_URL`,
      `COLD_TIER_WINDOW_DAYS`, `COLD_TIER_QUERY_TIMEOUT_SECS`.
- [ ] Cold schema migration runner: `CREATE TABLE IF NOT EXISTS cold_audit_log (...)`.
- [ ] `query_exec.rs`: for `audit-log` resource, fan out STDB + PG in parallel, merge.
- [ ] `/metrics`: add `cold_tier_cold_reads_total`, `cold_tier_cold_read_errors_total`,
      `cold_tier_merge_duration_seconds`.
- [ ] Integration test: STDB has recent rows, PG has old rows, `GET /api/query/audit-log`
      returns both merged; PG down → returns STDB rows only + warning log.

**Exit gate:** `audit-log` reads transparently merge; no frontend change; PG-down
degrades gracefully.

### Phase 2 — Eviction worker + remaining resources

**Goal:** Background eviction for the full archive-eligible set.

- [ ] `api-server/src/cold_tier/eviction.rs`: poll loop, batch fetch/insert/verify/delete.
- [ ] Cold schema for: `pos_order`, `pos_order_line`, `pos_payment`, `sale_order`,
      `sale_order_line`, `stock_move`, `account_move`, `account_move_line`.
- [ ] `query_exec.rs`: extend parallel fan-out to all archive-eligible resources.
- [ ] Eviction predicates per resource (§2.3) — especially the **closed-period** gate
      for `account_move` (must check `fiscal_period.state = closed` before evicting).
- [ ] `docker-compose.dev.yml` + `docker-compose.yml`: add `postgres` service +
      `cold-tier-data` volume; wire `DATABASE_URL` into api-server.
- [ ] `scripts/check-prod-env.sh`: require `DATABASE_URL` when `COLD_TIER_ENABLED=true`.
- [ ] `docs/ENVIRONMENT.md`: document cold-tier env vars.
- [ ] `docs/PRODUCTION_DEPLOY.md`: cold-tier deploy notes.

**Exit gate:** eviction worker archives closed/historical rows for all eligible
resources; `GET /api/query/pos-order` returns merged hot+cold transparently; deleting
from STDB only after verified PG insert (crash-safe).

### Phase 3 — AI-agent addressable surface + observability

**Goal:** AI action-drafts can inspect and trigger eviction; ops has full visibility.

- [ ] `GET /v1/cold-tier/backlog` (superuser) — per-org/resource eligible counts.
- [ ] `POST /v1/cold-tier/evict` (superuser) — one-shot eviction with `dry_run` support.
- [ ] `GET /v1/cold-tier/status` (superuser) — last run, errors, PG health.
- [ ] ai-gateway skill: `cold-tier-eviction` skill manifest so an AI agent can propose
      eviction via the existing action-draft flow.
- [ ] `/metrics`: `cold_tier_evicted_total{resource}`, `cold_tier_pg_pool_connections`,
      `cold_tier_eviction_duration_seconds`.
- [ ] `docs/PILOT_RUNBOOK.md`: cold-tier ops section (backlog inspection, manual
      eviction, PG health).

**Exit gate:** AI agent can inspect backlog and propose eviction via action-draft; human
approves; eviction runs; status observable.

### Phase 4 — Horizontal scaling investigation (research, not implementation)

**Goal:** Document the path to multi-node SpacetimeDB or partitioning, so the cold-tier
decision is made with eyes open about where it leads.

- [ ] Investigate SpacetimeDB commit-log truncation/checkpointing behavior
      (does `--data-dir` WAL grow unboundedly? Does Standalone support log compaction?
      Measure replay time as a function of log size).
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
| Window boundary skew (row evicted, then read races) | Merge dedupes by PK; no duplicate rows | Exclusive boundary (`age < W` for hot, `age >= W` for cold); row is in one tier only |
| Cold PG schema drift (new STDB column not in PG) | Eviction INSERT fails on missing column | Schema migration runner runs on api-server startup; column additions are additive |

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

---

## 7. What this does NOT change

- **Reducers** — no reducer is modified. Writes remain 100% SpacetimeDB.
- **Realtime subscriptions** — stay SpacetimeDB-only. Cold data is not pushed.
- **Frontend hooks** — zero changes (§4).
- **Audit log write path** — `write_audit_log_v2` still writes to SpacetimeDB; the
  eviction worker moves old rows to PG asynchronously.
- **Financial integrity invariants** — `account_move` is only evicted for **closed
  fiscal periods** (the period-lock infrastructure already exists); open-period moves
  stay in SpacetimeDB. This preserves all A2/A3/A4 invariants for active data.
- **The backup/restore story** — the cold PG instance is backed up independently
  (managed PITR or `pg_dump` → Object Storage). SpacetimeDB backup/restore (the
  block-snapshot + restic approach) remains as documented; it now backs up a smaller
  hot working set, which is faster and cheaper.

---

## 8. Open questions (to resolve in Phase 1/4)

1. **SpacetimeDB commit-log truncation:** does Standalone compact/truncate the WAL, or
   does it grow forever? If it grows forever, eviction shrinks the in-memory working set
   but not the on-disk log — replay time on restart may not improve. **Must measure
   before Phase 2.**
2. **Per-org window configurability:** is 90 days right for POS-heavy tenants? A
   high-volume retailer may want 30 days hot; a low-volume B2B may want 365. Default +
   per-org override via `organization_settings.cold_tier_window_days`.
3. **Cold-tier write-through for updated rows:** if a `sale_order` is evicted to PG and
   then later modified (e.g., a late credit note), the eviction worker must re-fetch
   and upsert the PG row. The current design evicts only `state = done/cancel` rows,
   which should be immutable — but verify no reducer mutates archived states.
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
