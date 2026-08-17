# Audit-log cold-by-default: first resource in the sliding-window architecture

**Status:** Proposed — 2026-08-17
**Author:** Architecture planning
**Tracks:** `storage-tier`, `audit`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [backup-recovery-followup.md](./backup-recovery-followup.md)
**Parent plan:** This is a specialization of the sliding-window cold-tier architecture. Audit-log is treated differently from transactional tables (which stay hot in STDB and are evicted later). Audit-log is **cold from the moment of creation** — it never lives in STDB's in-memory row store.

---

## 1. Why audit-log is special

Audit-log is fundamentally different from every other table in the archive-eligible set:

| Property | Transactional tables (pos_order, account_move, etc.) | Audit-log |
|---|---|---|
| Write pattern | Reducer inserts/updates | Append-only, never updated, never deleted |
| Read pattern | Frequently read (UI lists, dashboards, lookups) | Rarely read (compliance audit, debugging only) |
| Realtime subscription | Yes (users see live updates) | No (nobody subscribes to audit-log changes) |
| Mutation after creation | Yes (state transitions, credit notes) | **Never** (write-once, immutable) |
| Growth rate | Proportional to business volume | **Every reducer call** (1,089 call sites across 624 reducers) |
| Need for re-hydration | Yes (late mutations on evicted rows) | **No** (never mutated after insert) |

Because audit-log is write-once and never read in realtime, it doesn't benefit from being in SpacetimeDB's in-memory store at all. It consumes RAM (~1,200–2,000 bytes/row, see row-size analysis) for data that is almost never accessed, and it grows faster than any other table.

**The optimization:** route audit writes directly to Postgres and serve audit reads from Postgres only. SpacetimeDB never holds audit rows. The reducer logic stays exactly the same — the 1,089 call sites don't change. Only the *sink* changes.

---

## 2. Architecture

### 2.1 Current state (today)

```
Reducer (624 reducers, 1,089 audit call sites)
  │
  ▼
helpers::write_audit_log_v2(ctx, org_id, params)
  │
  ▼
ctx.db.audit_log().insert(AuditLog { ... })    ← writes to STDB in-memory
  │
  ▼ (query_exec.rs line 1456)
GET /api/query/audit-log
  │
  ▼
SELECT ... FROM audit_log WHERE organization_id = ?
  │ (STDB HTTP SQL, truncated to 500 rows, sorted by id DESC)
  ▼
Frontend: useAuditLog() → fetchQueryList('/api/query/audit-log')
```

### 2.2 Proposed state (cold-by-default)

```
Reducer (624 reducers, 1,089 audit call sites — UNCHANGED)
  │
  ▼
helpers::write_audit_log_v2(ctx, org_id, params)
  │
  ▼  (NEW: audit_write_forwarder — see §3)
  │
  ├──► STDB audit_log table: NO LONGER INSERTED (feature-gated)
  │
  └──► Postgres cold_audit_log table: INSERT (via api-server async forwarder)
       │
       ▼ (query_exec.rs — MODIFIED, audit-log branch only)
  GET /api/query/audit-log
       │
       ▼
  SELECT ... FROM cold_audit_log WHERE organization_id = ?
  ORDER BY id DESC LIMIT 500
       │ (tokio-postgres + deadpool-postgres — see cold-tier plan §3.1)
       ▼
  Frontend: useAuditLog() → fetchQueryList('/api/query/audit-log') — UNCHANGED
```

### 2.3 What changes and what doesn't

| Component | Changes? | Details |
|---|---|---|
| `spacetimedb/src/core/audit.rs` (AuditLog table def) | **Keep** | Table stays in the module for schema/compilation. Inserts become no-ops when cold tier is active (feature-gated). |
| `spacetimedb/src/helpers.rs` (`write_audit_log_v2`) | **Minimal** | Add a feature-gated branch: if cold-tier audit is active, skip the STDB insert and queue the event for PG. See §3. |
| 1,089 call sites across 624 reducers | **None** | Every call still calls `write_audit_log_v2(ctx, org_id, params)`. The function's signature and behavior from the caller's perspective is unchanged. |
| `api-server/src/query_exec.rs` (audit-log branch, line 1456) | **Replace** | Instead of `SELECT ... FROM audit_log` via STDB HTTP SQL, query `cold_audit_log` via tokio-postgres. See §4. |
| `frontend/packages/query-hooks/src/hooks/auth.ts` (`useAuditLog`) | **None** | Still calls `fetchQueryList('/api/query/audit-log')`. The api-server returns the same JSON shape. |
| `frontend/packages/ui/src/settings/audit-log.tsx` | **None** | Consumes the same data shape. |
| `frontend/packages/ui/src/entity-views/record-audit-tab.tsx` | **None** | Same hook, same data. |
| `crates/stdb-auth/assets/resource_registry.json` (`audit-log` entry) | **None** | Stays registered — the api-server still serves it, just from a different store. |
| `spacetimedb/src/core/audit.rs` (`log_audit_event` reducer) | **Keep** | Remains as a fallback when cold tier is disabled. |

---

## 3. Write path: audit_write_forwarder

### 3.1 The problem: reducers can't do network I/O

SpacetimeDB reducers are deterministic — they cannot make HTTP requests. So the audit
write can't go directly to Postgres from inside the reducer. Two approaches:

### 3.2 Approach A: Async forwarder queue (recommended for Phase 1)

The reducer writes audit events to a **lightweight STDB queue table** (`audit_forwarder_queue`)
instead of the main `audit_log` table. An api-server background task drains the queue and
inserts into Postgres, then deletes from the queue.

```
Reducer
  │
  ▼
write_audit_log_v2(ctx, org_id, params)
  │
  ├── if COLD_TIER_AUDIT_ENABLED (env-gated at module publish time):
  │     └── ctx.db.audit_forwarder_queue().insert(AuditForwarderEntry { ... })
  │         (tiny row: id + org_id + JSON payload — ~200 bytes, drained within seconds)
  │
  └── else (cold tier disabled):
        └── ctx.db.audit_log().insert(AuditLog { ... })  (existing behavior)
```

The `audit_forwarder_queue` table is a **transient buffer**, not a storage table:

```rust
#[spacetimedb::table(
    accessor = audit_forwarder_queue,
    index(accessor = audit_fwd_by_org, btree(columns = [organization_id]))
)]
pub struct AuditForwarderEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub payload: String,  // JSON-serialized LogAuditEventParams + system fields
    pub created_at: Timestamp,
}
```

The api-server audit drainer (a new background task, or part of the cold-tier worker)
runs on a short interval (default 5 seconds):

```
loop:
  sleep(5s)
  1. Query STDB: SELECT id, payload FROM audit_forwarder_queue LIMIT 500
  2. For each batch:
     a. Parse JSON payloads
     b. INSERT INTO cold_audit_log (...) VALUES (...) ON CONFLICT DO NOTHING
     c. Verify PG insert count
     d. DELETE FROM audit_forwarder_queue WHERE id IN (...)
  3. Log: rows_forwarded, duration
  4. Update /metrics: audit_forwarded_total, audit_forward_lag_seconds
```

**Why this works:** the queue rows are tiny (~200 bytes each vs ~1,500 bytes for a full
AuditLog row). They live in STDB for seconds, not years. The RAM impact is negligible
(a 5-second drain window at 100 writes/second = ~500 rows × 200 bytes = ~100 KB).

**Why not just skip the STDB insert entirely:** reducers must write *somewhere* to
record the audit event transactionally. If the reducer does nothing, the audit event is
lost (the reducer can't call the api-server). The queue table is the transactional
bridge: the reducer writes to the queue (transactional, durable via WAL), and the
drainer forwards to PG (async, best-effort with retry).

### 3.3 Approach B: SpacetimeDB procedure (future, Phase 3+)

Once the `features = ["unstable"]` gate is enabled (per the cold-tier plan §2.5), a
procedure could write directly to Postgres via HTTP:

```rust
#[spacetimedb::procedure]
pub fn write_audit_to_pg(ctx: &mut ProcedureContext, org_id: u64, payload: String) -> Result<(), String> {
    let request = spacetimedb::http::Request::builder()
        .uri("http://api-server:8082/v1/cold-tier/audit/write")
        .method("POST")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", service_token))
        .body(payload.clone())
        .map_err(|e| format!("{e}"))?;
    ctx.http.send(request).map_err(|e| format!("{e:?}"))?;
    Ok(())
}
```

This eliminates the queue entirely — the reducer calls the procedure, the procedure
HTTP-POSTs to the api-server, the api-server writes to PG. But procedures are
non-transactional (they manage their own transactions), so the audit write is not
in the same transaction as the reducer's business logic. If the procedure fails
(PG down, api-server unreachable), the audit event is lost — unless the reducer
catches the failure and falls back to the queue table.

**Recommendation:** start with Approach A (queue + drainer) for Phase 1. It's
simpler, transactional, and crash-safe. Evaluate Approach B in Phase 3+ once
procedures are proven in the codebase.

---

## 4. Read path: query_exec.rs modification

### 4.1 Current code (query_exec.rs line 1456)

```rust
"audit-log" => {
    let sql = format!(
        "SELECT id, organization_id, company_id, table_name, record_id, action, \
         old_values, new_values, session_id, ip_address, user_agent, timestamp \
         FROM audit_log WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    sort_rows_by_id_desc(&mut rows);
    rows.truncate(500);
    return Ok(rows);
}
```

### 4.2 Modified code (cold-by-default)

```rust
"audit-log" => {
    if cold_tier.is_audit_cold() {
        // Cold-by-default: read entirely from Postgres
        return cold_tier.read_audit_log(organization_id, 500)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()));
    }
    // Fallback: cold tier disabled, read from STDB (existing behavior)
    let sql = format!(
        "SELECT id, organization_id, company_id, table_name, record_id, action, \
         old_values, new_values, session_id, ip_address, user_agent, timestamp \
         FROM audit_log WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    sort_rows_by_id_desc(&mut rows);
    rows.truncate(500);
    return Ok(rows);
}
```

### 4.3 The PG read function (in `api-server/src/cold_tier/audit.rs`)

```rust
use deadpool_postgres::Object;

pub async fn read_audit_log(
    pool: &deadpool_postgres::Pool,
    organization_id: i64,
    limit: usize,
) -> Result<Vec<serde_json::Value>, tokio_postgres::Error> {
    let client = pool.get().await?;
    let sql = "SELECT id, organization_id, company_id, table_name, record_id, action, \
               old_values, new_values, changed_fields, user_identity, session_id, \
               ip_address, user_agent, timestamp, metadata \
               FROM cold_audit_log \
               WHERE organization_id = $1 \
               ORDER BY id DESC LIMIT $2";
    let rows = client.query(sql, &[&organization_id, &(limit as i64)]).await?;

    Ok(rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<_, i64>(0).to_string(),
            "organization_id": row.get::<_, i64>(1).to_string(),
            "company_id": row.get::<_, Option<i64>>(2).map(|v| v.to_string()),
            "table_name": row.get::<_, String>(3),
            "record_id": row.get::<_, i64>(4).to_string(),
            "action": row.get::<_, String>(5),
            "old_values": row.get::<_, Option<String>>(6),
            "new_values": row.get::<_, Option<String>>(7),
            "changed_fields": row.get::<_, Vec<String>>(8),
            "user_identity": row.get::<_, String>(9),
            "session_id": row.get::<_, Option<i64>>(10).map(|v| v.to_string()),
            "ip_address": row.get::<_, Option<String>>(11),
            "user_agent": row.get::<_, Option<String>>(12),
            "timestamp": row.get::<_, chrono::DateTime<chrono::Utc>>(13).to_rfc3339(),
            "metadata": row.get::<_, Option<String>>(14),
        })
    }).collect())
}
```

The returned JSON matches the shape the frontend expects (bigint IDs as strings,
timestamps as ISO 8601 — same serialization the STDB HTTP SQL path returns).

### 4.4 The PG write function (drainer → PG insert)

```rust
pub async fn write_audit_batch(
    pool: &deadpool_postgres::Pool,
    entries: &[AuditForwarderEntry],
) -> Result<u64, tokio_postgres::Error> {
    let client = pool.get().await?;
    let mut count = 0u64;
    for entry in entries {
        let payload: serde_json::Value = serde_json::from_str(&entry.payload)
            .unwrap_or(serde_json::Value::Null);

        let result = client.execute(
            "INSERT INTO cold_audit_log \
             (id, organization_id, company_id, table_name, record_id, action, \
              old_values, new_values, changed_fields, user_identity, session_id, \
              ip_address, user_agent, timestamp, metadata, archived_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now()) \
             ON CONFLICT (id) DO NOTHING",
            &[
                &payload["id"].as_i64().unwrap_or(0),
                &payload["organization_id"].as_i64().unwrap_or(0),
                &payload["company_id"].as_i64(),
                &payload["table_name"].as_str().unwrap_or(""),
                &payload["record_id"].as_i64().unwrap_or(0),
                &payload["action"].as_str().unwrap_or(""),
                &payload["old_values"].as_str(),
                &payload["new_values"].as_str(),
                &payload["changed_fields"].as_array()
                    .map(|a| a.iter()
                        .map(|v| v.as_str().unwrap_or("").to_string())
                        .collect::<Vec<_>>())
                    .unwrap_or_default(),
                &payload["user_identity"].as_str().unwrap_or(""),
                &payload["session_id"].as_i64(),
                &payload["ip_address"].as_str(),
                &payload["user_agent"].as_str(),
                &payload["timestamp"].as_str().unwrap_or(""),
                &payload["metadata"].as_str(),
            ],
        ).await?;
        count += result;
    }
    Ok(count)
}
```

---

## 5. Postgres schema (generated projection — same as cold-tier plan §2.6)

```sql
CREATE TABLE IF NOT EXISTS cold_audit_log (
    id              BIGINT PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    company_id      BIGINT,
    table_name      TEXT NOT NULL,
    record_id       BIGINT NOT NULL,
    action          TEXT NOT NULL,
    old_values      JSONB,
    new_values      JSONB,
    changed_fields  JSONB,
    user_identity   TEXT NOT NULL,
    session_id      BIGINT,
    ip_address      TEXT,
    user_agent      TEXT,
    timestamp       TIMESTAMPTZ NOT NULL,
    metadata       JSONB,
    archived_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cold_audit_log_org
    ON cold_audit_log (organization_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_cold_audit_log_table
    ON cold_audit_log (organization_id, table_name);
CREATE INDEX IF NOT EXISTS idx_cold_audit_log_record
    ON cold_audit_log (organization_id, table_name, record_id);
```

The `(organization_id, id DESC)` index serves the primary read path (latest 500 by org).
The `(organization_id, table_name, record_id)` index serves the record-audit-tab view
("show me audit history for this specific record").

This schema is emitted by `pg_schema_emit.rs` in `lumiere-codegen` — same as the
cold-tier plan §2.6. No hand-written DDL.

---

## 6. Impact on RAM

### Before (audit_log in STDB)

| Audit volume | Rows in STDB (1 year) | RAM consumed |
|---|---|---|
| 50 users × 30 actions/day | 548K rows | ~660 MB |
| 100 users × 30 actions/day | 1.1M rows | ~1.3 GB |
| 100 users × 50 actions/day | 1.8M rows | ~2.2 GB |
| 100 users × 100 actions/day | 3.7M rows | ~4.4 GB |

### After (audit_log cold-by-default, queue only)

| Audit volume | Queue rows in STDB (5s drain window) | RAM consumed |
|---|---|---|
| 100 writes/sec | ~500 rows (5s × 100/s) | ~100 KB |
| 1000 writes/sec | ~5,000 rows (5s × 1000/s) | ~1 MB |

**The audit table goes from the single largest RAM consumer to negligible.** The
queue is a transient buffer that drains within seconds — it never accumulates.

### Combined with the sliding-window plan

The sliding-window cold-tier plan (for transactional tables like `pos_order`,
`account_move`) is **unchanged**. This audit-log optimization is a special case:
audit-log doesn't need the sliding window (no eviction worker, no `cold_eligible_at`,
no re-hydration procedure) because it's cold from creation. The two approaches
coexist:

| Table class | Storage | Eviction | Re-hydration | Window |
|---|---|---|---|---|
| **Audit-log** | PG only (cold by default) | N/A (never in STDB) | N/A (never mutated) | N/A |
| **Transactional tables** (pos_order, account_move, etc.) | STDB hot → PG cold (sliding window) | Yes (eviction worker) | Yes (procedure fallback) | 90 days |

---

## 7. Implementation phases

### Phase 1A — Audit-log cold-by-default (this plan)

**Goal:** Audit writes go to PG, reads come from PG, STDB only holds the transient queue.

- [ ] Add `tokio-postgres` + `deadpool-postgres` to `api-server/Cargo.toml` (per cold-tier plan §3.1).
- [ ] Add `AuditForwarderEntry` table to `spacetimedb/src/core/audit.rs`.
- [ ] Modify `write_audit_log_v2` in `helpers.rs`: feature-gated branch — insert to
      `audit_forwarder_queue` when `COLD_TIER_AUDIT_ENABLED`, else existing `audit_log` insert.
- [ ] Add `api-server/src/cold_tier/audit.rs`: `read_audit_log()` and `write_audit_batch()`.
- [ ] Add `api-server/src/cold_tier/audit_drainer.rs`: background task that drains the
      queue → PG every 5 seconds.
- [ ] Wire the drainer into the api-server startup (or the cold-tier worker binary).
- [ ] Modify `query_exec.rs` audit-log branch: route to `cold_tier.read_audit_log()`
      when cold tier is active, else existing STDB query.
- [ ] Cold schema migration: `CREATE TABLE IF NOT EXISTS cold_audit_log (...)`.
- [ ] `/metrics`: `audit_forwarded_total`, `audit_forward_lag_seconds`,
      `audit_forward_queue_depth`.
- [ ] Integration test: reducer writes audit event → queue → drainer → PG →
      `GET /api/query/audit-log` returns the row from PG.
- [ ] Integration test: PG down → drainer retries, queue grows, no data loss.
      `GET /api/query/audit-log` falls back to STDB queue or returns empty + warning.

**Exit gate:** audit events written by reducers appear in `GET /api/query/audit-log`
within 10 seconds; no frontend change; STDB `audit_log` table is empty (or near-empty
queue only); PG holds all audit data.

### Phase 1B — Cold-tier foundation for transactional tables (existing plan)

Proceeds as documented in `sliding-window-cold-tier.md` Phase 1, but the PG connection
pool, `deadpool-postgres` dependency, and `ColdTierPg` struct are already in place from
Phase 1A.

---

## 8. Failure modes

| Failure | Impact | Mitigation |
|---|---|---|
| Postgres unreachable (drainer can't write) | Queue grows in STDB; reads return stale/empty from PG | Drainer retries with backoff; queue depth metric alerts at >10K rows; `GET /api/query/audit-log` degrades to reading from the STDB queue (best-effort, most recent only) |
| Postgres unreachable (read path) | `GET /api/query/audit-log` fails | Return empty list + `tracing::warn`; don't fail the request (audit is non-critical for UI) |
| Drainer crashes mid-batch | Queue rows not deleted (PG insert verified before DELETE) | Next run re-fetches same rows; idempotent `ON CONFLICT DO NOTHING` |
| STDB restarts with undrained queue | Queue rows survive in STDB WAL (durable) | Drainer picks up on api-server restart; no data loss |
| Cold tier disabled at runtime | Audit writes go to STDB `audit_log` table (existing behavior) | Feature-gated; `COLD_TIER_AUDIT_ENABLED` env var checked at startup |

---

## 9. Migration path (existing STDB audit_log data)

If the STDB `audit_log` table already has historical rows when the cold tier is enabled:

1. **One-time backfill:** the cold-tier worker (or a one-shot script) reads all rows
   from STDB `audit_log` and inserts them into `cold_audit_log` (ON CONFLICT DO NOTHING).
2. **After backfill is verified:** truncate the STDB `audit_log` table (the rows are
   safely in PG). This immediately frees RAM.
3. **Going forward:** new audit events go through the queue → PG path.

The backfill is idempotent and can be re-run safely.

---

## 10. What this does NOT change

- **Reducer logic** — all 1,089 call sites still call `write_audit_log_v2(ctx, org_id, params)`.
  No reducer is modified. The function's contract from the caller's perspective is unchanged.
- **Frontend** — `useAuditLog()` still calls `fetchQueryList('/api/query/audit-log')`.
  No hook, component, or query key changes.
- **Audit rules** (`AuditRule` table, `create_audit_rule` reducer) — stays in STDB.
  Rules are small (one row per table per org) and frequently read.
- **Financial integrity** — audit logs are compliance records, not transactional data.
  Moving them to PG doesn't affect any accounting invariant.
- **The sliding-window cold-tier plan** — this is a specialization for one table.
  The general architecture (eviction worker, codegen, merge path, re-hydration
  procedure) is unchanged for transactional tables.

---

## 11. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-17 | Audit-log is cold-by-default, not sliding-window | Write-once, never-mutated, rarely-read, highest-growth table — no benefit to being in RAM |
| 2026-08-17 | Audit writes via async forwarder queue (not procedure) | Reducers can't do HTTP; queue is transactional and crash-safe; procedures are Phase 3+ |
| 2026-08-17 | Audit reads from PG only (no STDB hot copy) | No realtime subscription on audit-log; no merge path needed; simpler than the sliding-window approach |
| 2026-08-17 | `AuditRule` table stays in STDB | Small, frequently read, used for permission checks — belongs in the hot tier |
| 2026-08-17 | Audit-log is Phase 1A (before transactional cold-tier) | Highest RAM impact, simplest to implement, no eviction worker or re-hydration needed; proves the PG connection + codegen pipeline before the more complex sliding window |
