# Backup & recovery follow-up: cold-tier impact + SpacetimeDB snapshot verification

**Status:** Proposed — 2026-08-17
**Author:** Architecture planning
**Tracks:** `storage-tier`, `backup-restore`, `production-readiness`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [PRODUCTION_DEPLOY.md](../PRODUCTION_DEPLOY.md) · [PILOT_RUNBOOK.md](../PILOT_RUNBOOK.md)
**Verified against:** SpacetimeDB 2.0 official docs (spacetimedb.com), docs.rs `spacetimedb-snapshot` v1.3.0, GitHub clockworklabs/SpacetimeDB

---

## 1. What changed since the original backup plan

The original backup strategy (Phase 2 of the readiness assessment) was designed for a
single-tier SpacetimeDB-only deployment:

- **restic** → Scaleway Object Storage, backing up the `spacetimedb-data` Docker volume.
- Hourly block-volume snapshots, nightly fulls, monthly archives → Glacier.
- RPO ≤ 1h, RTO ~15 min.
- No point-in-time or row-level recovery.

The cold-tier architecture changes the data topology:

| Tier | Store | What lives here | Backup method |
|---|---|---|---|
| **Hot** | SpacetimeDB (in-memory + commit-log WAL) | Active working set: open orders, current period, live stock, recent audit | restic on `spacetimedb-data` volume + native snapshots (§3) |
| **Cold** | Postgres (disk-backed) | Evicted rows: archived orders, closed-period moves, historical audit | `pg_dump` / managed PITR (§5) |
| **AI/RAG** | Qdrant (disk-backed) | Vector embeddings | restic on `qdrant-data` volume |
| **Artifacts** | Filesystem (owner-report-artifacts volume) | Generated PDFs | restic on `owner-report-artifacts` volume |

**Key insight:** the cold tier *improves* the backup story. Once historical data is
evicted to Postgres, SpacetimeDB's working set is smaller — snapshots are faster,
replay time on restart is shorter, and the restic backup of the hot volume is smaller.
Postgres brings its own mature backup tooling (PITR, `pg_dump`, WAL archiving) that
SpacetimeDB lacks natively.

---

## 2. SpacetimeDB native snapshot capability (verified)

### What the docs confirm

SpacetimeDB has a **`spacetimedb-snapshot`** crate (v1.3.0, published on docs.rs and
crates.io) that implements on-disk snapshot capture and restore:

> "A snapshot is an on-disk view of the committed state of a database at a particular
> transaction offset. Snapshots exist as an optimization over replaying the commitlog;
> when restoring to the most recent transaction, rather than replaying the commitlog
> from 0, we can reload the most recent snapshot, then replay only the suffix of the
> commitlog."

**Source:** [docs.rs/spacetimedb-snapshot](https://docs.rs/spacetimedb-snapshot)

The crate provides:
- `SnapshotRepository` — manages multiple snapshots of a DB; can create and retrieve them.
- `SnapshotRepository::create_snapshot` — captures a snapshot given a view of committed state.
- `SnapshotRepository::read_snapshot` — reads an on-disk snapshot into memory as a
  `ReconstructedSnapshot`, which can then be installed into a datastore.
- `SnapshotRepository::latest_snapshot` / `latest_snapshot_older_than` — locates the
  most-recent snapshot, or the most recent one not newer than a given tx offset.

**What the crate does NOT do** (these are the host's responsibility):
- Decide *when* to capture snapshots (scheduling).
- Decide *which* snapshot to restore from after a restart.
- Replay the commit-log suffix after restoring a snapshot.
- Transform a `ReconstructedSnapshot` into a live Spacetime datastore.

The SpacetimeDB standalone host handles these internally — when you start a database,
it automatically looks for the latest snapshot and replays only the commit-log suffix.

### Commit-log configuration (verified)

The standalone `config.toml` (v2.0.0 docs) exposes `[commitlog]` settings:

```toml
[commitlog]
log-format-version = 1
max-segment-size = 1073741824          # 1 GiB per segment
offset-index-interval-bytes = 4096     # index entry every 4 KiB
offset-index-require-segment-fsync = true
preallocate-segments = false
write-buffer-size = 131072             # 128 KiB write buffer
```

**Source:** [spacetimedb.com/docs/cli-reference/standalone-config/](https://spacetimedb.com/docs/cli-reference/standalone-config/)

This means:
- The commit-log grows in 1 GiB segments (configurable).
- Snapshots allow the database to skip replaying old segments on restart.
- The commit-log itself is NOT truncated by snapshots — old segments remain on disk
  until manually removed or until SpacetimeDB introduces automatic truncation. **This is
  the remaining open question** (§7, question 1 of the cold-tier plan is partially
  resolved: snapshots reduce replay time but not disk usage without manual cleanup).

### What this means for Lumiere

| Before cold tier | After cold tier + snapshots |
|---|---|
| Full data-dir tar backup (large, grows unboundedly) | Smaller hot working set → smaller snapshot → faster backup |
| Restart replays entire commit-log from offset 0 | Restart loads latest snapshot + replays only the suffix |
| No point-in-time recovery for historical data | Postgres PITR for evicted (historical) data |
| RPO ≤ 1h for everything (restic on volume) | RPO ≤ 1h for hot (restic + snapshot), RPO ≤ 5min for cold (PG WAL streaming) |

---

## 3. Updated backup architecture

### 3.1 Hot tier (SpacetimeDB)

**Two complementary mechanisms:**

1. **restic on `spacetimedb-data` volume** (existing, enhanced):
   - Hourly block-volume snapshots of the Docker volume.
   - Nightly full backup → Scaleway Object Storage.
   - Monthly archive → Scaleway Glacier (~€0.002/GB/month).
   - This captures the commit-log segments AND any snapshot files on disk.

2. **Native SpacetimeDB snapshots** (new):
   - The standalone host captures snapshots automatically based on internal heuristics
     (the `spacetimedb-snapshot` crate is used by the host, not by the module).
   - These snapshots live on-disk in the data directory and are captured by the restic
     backup.
   - On restart, the host loads the latest snapshot + replays the commit-log suffix.
   - **No additional configuration needed** — this is built into SpacetimeDB 2.0.

**Consistency guarantee:** the restic backup must be taken while SpacetimeDB is either
stopped or while it's in a quiescent state. The existing `backup-stdb.sh` script already
notes: "stop spacetime first for a consistent copy." For production, use restic's
`--fsync` or take a filesystem-level snapshot (LVM/ZFS/btrfs) of the Docker volume
while SpacetimeDB is running, since the commit-log is fsync'd on every transaction.

### 3.2 Cold tier (Postgres)

**Recommended: Scaleway Managed PostgreSQL (RDB)** with:
- **Automated daily backups** with 7-day retention (default).
- **Point-in-time recovery (PITR)** via WAL archiving — RPO ≤ 5 minutes.
- **High availability** (optional, standby replica with automatic failover).

**Self-hosted alternative** (Docker Postgres on Scaleway):
- `pg_dump` nightly → Scaleway Object Storage (full + incremental via `pg_dump --format=custom`).
- WAL archiving (`archive_command`) → Scaleway Object Storage for PITR.
- `pg_basebackup` for streaming replication to a standby (if HA needed).

**Recovery scenarios:**

| Scenario | Method | RPO | RTO |
|---|---|---|---|
| Accidental row deletion in PG | PITR via `pg_wal` replay | ≤ 5 min | ~10 min |
| PG instance failure | Failover to standby (managed) or restore from `pg_dump` | ≤ 5 min (managed) / ≤ 24h (self-hosted) | ~5 min (managed) / ~30 min (self-hosted) |
| Corrupt PG table | Restore from latest `pg_dump` + WAL replay | ≤ 5 min | ~15 min |

### 3.3 AI/RAG tier (Qdrant)

- restic on `qdrant-data` Docker volume → Scaleway Object Storage.
- Nightly full backup. Qdrant collections can be rebuilt from source documents if needed
  (the ai-gateway re-embeds from SpacetimeDB text fields).
- RPO ≤ 24h, RTO ~30 min (rebuild from backup or re-embed from source).

### 3.4 Artifacts (owner reports)

- restic on `owner-report-artifacts` Docker volume → Scaleway Object Storage.
- Nightly full backup. Reports are regenerable from SpacetimeDB data.
- RPO ≤ 24h, RTO ~10 min.

### 3.5 Redis

- **No backup needed.** Redis is configured with `--save "" --appendonly no` (no
  persistence). It holds only ephemeral session/cache data. On restart, the cache
  repopulates from SpacetimeDB.

---

## 4. Re-hydration procedure: verified API (SpacetimeDB 2.0)

**Verified against:** [spacetimedb.com/docs/1.12.0/functions/procedures/](https://spacetimedb.com/docs/1.12.0/functions/procedures/)

The official SpacetimeDB documentation confirms that Rust procedures CAN make HTTP
requests and CAN open database transactions. The exact API:

### 4.1 Procedure definition

```rust
// spacetimedb/Cargo.toml MUST enable the unstable feature:
// [dependencies]
// spacetimedb = { version = "2.0.1", features = ["unstable"] }

use spacetimedb::{procedure, ProcedureContext};

#[spacetimedb::procedure]
pub fn ensure_row_hydrated(
    ctx: &mut ProcedureContext,
    table_name: String,
    row_id: u64,
) -> Result<(), String> {
    // STEP 1: HTTP GET to api-server re-hydration endpoint
    // (must complete BEFORE opening a transaction — procedures cannot
    //  send HTTP requests while holding a transaction open)
    let url = format!(
        "http://api-server:8082/v1/cold-tier/row/{}/{}",
        table_name, row_id
    );
    let response = ctx.http.get(&url)
        .map_err(|e| format!("Re-hydration HTTP request failed: {e:?}"))?;
    let (parts, body) = response.into_parts();
    if parts.status != 200 {
        return Err(format!("Re-hydration endpoint returned status {}", parts.status));
    }
    let row_json = body.into_string_lossy();

    // STEP 2: Open a transaction and re-insert the row
    // (ctx.with_tx gives full read-write access, same as ReducerContext)
    ctx.try_with_tx(|tx_ctx| {
        // Parse the JSON row and insert into the appropriate table
        // (the actual table access depends on which table is being hydrated;
        //  codegen can emit per-table variants of this procedure)
        insert_row_from_json(tx_ctx, &table_name, &row_json)?;
        Ok(())
    }).map_err(|e| format!("Re-hydration transaction failed: {e}"))?;

    Ok(())
}
```

### 4.2 Key constraints (from official docs)

1. **HTTP before transaction:** "Procedures can't send requests at the same time as
   holding open a transaction." The HTTP GET must complete before `ctx.with_tx` is
   called. Our design already follows this order (fetch from PG first, then insert).

2. **`with_tx` may be retried:** "The function passed to `ProcedureContext::with_tx`
   may be invoked multiple times, possibly seeing a different version of the database
   state each time." The insert closure must be idempotent — use
   `ON CONFLICT DO NOTHING` semantics (check if row exists before inserting).

3. **Unstable feature required:** Rust modules must opt in via
   `features = ["unstable"]` in `Cargo.toml`. The Lumiere project currently uses
   `spacetimedb = { version = "2.0.1" }` without the feature. **This is a Phase 3
   prerequisite.**

4. **Synchronous in WASM:** In the WASM runtime (which Lumiere uses — `cdylib`), HTTP
   calls are synchronous and yield via async host functions internally. The procedure
   blocks until the HTTP response arrives. This is fine for a single-row fetch (the
   api-server endpoint returns in <100ms for a single PG row read).

5. **Timeout support:** `ctx.http.send()` accepts a `spacetimedb::http::Timeout`
   extension on the request:
   ```rust
   let request = spacetimedb::http::Request::builder()
       .uri(&url)
       .method("GET")
       .extension(spacetimedb::http::Timeout(
           std::time::Duration::from_secs(5).into()
       ))
       .body(())
       .expect("Building Request object failed");
   ```

### 4.3 Re-hydration endpoint (api-server side)

The api-server exposes an internal endpoint that the procedure calls:

```
GET /v1/cold-tier/row/:table/:id
Authorization: Bearer <service-token>
```

Returns the row as JSON (same serialization as the query-exec merge path). This endpoint
is **service-token-only** (not superuser, not user-facing) — only the SpacetimeDB
procedure and the eviction worker use it.

### 4.4 Why a procedure (not a reducer)

Reducers are deterministic — they cannot make HTTP requests, access the filesystem, use
timers, or generate random numbers. This is a hard constraint of the SpacetimeDB
execution model (all reducer calls must produce the same result when replayed from the
commit-log).

Procedures are explicitly designed for non-deterministic operations: HTTP requests to
external services, then optionally committing changes via an explicit transaction.
They are NOT replayed from the commit-log (they don't participate in the WAL). This
makes them the correct tool for re-hydration: fetch from PG (non-deterministic) →
insert into STDB (transactional).

---

## 5. Updated recovery procedures

### 5.1 Hot tier recovery (SpacetimeDB)

**Scenario:** SpacetimeDB container crash, data corruption, or host failure.

```
1. Stop the SpacetimeDB container.
2. Restore the spacetimedb-data volume from latest restic snapshot:
   restic restore latest --target /tmp/restore
   cp -a /tmp/restore/data/* /var/lib/docker/volumes/spacetimedb-data/_data/
3. Start the SpacetimeDB container.
4. SpacetimeDB automatically:
   a. Loads the latest native snapshot from the data directory.
   b. Replays the commit-log suffix (transactions after the snapshot).
   c. Database is live with all data up to the last committed transaction.
```

**RTO:** ~10-15 minutes (volume restore + snapshot load + suffix replay).
**RPO:** ≤ 1 hour (last restic backup) — but committed transactions between the last
backup and the crash are recovered from the commit-log on-disk (if the volume is
intact) or lost (if the volume is corrupted). For the latter, RPO = last backup.

### 5.2 Cold tier recovery (Postgres)

**Scenario:** Postgres data loss, corruption, or instance failure.

**Managed (Scaleway RDB):**
```
1. Use Scaleway console/CLI to restore to a point in time:
   scw rdb backup restore <instance-id> <backup-id> --recovery-point "<timestamp>"
2. Update DATABASE_URL to point to the restored instance.
3. The eviction worker and query_exec merge path reconnect automatically.
```

**Self-hosted:**
```
1. Stop the Postgres container.
2. Restore from latest pg_dump:
   pg_restore --clean --if-exists -d lumiere_cold /backups/latest.dump
3. Or restore via WAL replay (PITR):
   pg_ctl -D /var/lib/postgresql/data stop
   rm -rf /var/lib/postgresql/data/*
   pg_basebackup -h standby -D /var/lib/postgresql/data -P -R
   pg_ctl -D /var/lib/postgresql/data start
4. Start the Postgres container.
```

**RTO:** ~5-15 min (managed) / ~15-30 min (self-hosted).
**RPO:** ≤ 5 min (managed PITR) / ≤ 24h (self-hosted `pg_dump` only).

### 5.3 Full disaster recovery (both tiers)

**Scenario:** Complete Scaleway instance loss (both SpacetimeDB and Postgres).

```
1. Provision a new Scaleway instance.
2. Restore SpacetimeDB from restic backup (§5.1).
3. Restore Postgres from managed backup / pg_dump (§5.2).
4. Redeploy api-server, ai-gateway, frontend from CI/CD (docker-compose up).
5. Verify: cold-tier backlog endpoint, merged query for a historical resource,
   re-hydration procedure (call ensure_row_hydrated on a test row).
```

**RTO:** ~30-45 minutes.
**RPO:** ≤ 1 hour (hot) / ≤ 5 min (cold).

### 5.4 Re-hydration failure recovery

**Scenario:** The re-hydration procedure fails (api-server unreachable, PG down during
a late mutation).

```
1. The reducer that called ensure_row_hydrated returns Err.
2. The user sees a standard reducer error (same as any reducer failure).
3. Hot data is unaffected — the failure is isolated to the evicted row.
4. On retry, the procedure re-attempts the HTTP GET.
5. If PG is down, the api-server returns 503; the procedure returns Err.
6. No data corruption: the STDB transaction was never opened (HTTP failed first).
```

---

## 6. Backup schedule summary

| What | Method | Frequency | Retention | RPO | Storage |
|---|---|---|---|---|---|
| SpacetimeDB hot data | restic (volume snapshot) | Hourly snapshot, nightly full | 7 daily, 4 weekly, 12 monthly | ≤ 1h | Scaleway Object Storage |
| SpacetimeDB snapshots | Native (automatic by host) | Automatic | On-disk in data dir | N/A (captured by restic) | `spacetimedb-data` volume |
| Postgres cold data (managed) | Scaleway automated backup + WAL | Continuous WAL, daily full | 7 days PITR | ≤ 5 min | Scaleway RDB managed |
| Postgres cold data (self-hosted) | `pg_dump` + WAL archiving | Nightly full, continuous WAL | 7 days | ≤ 5 min (WAL) / ≤ 24h (dump) | Scaleway Object Storage |
| Qdrant vectors | restic (volume) | Nightly full | 7 days | ≤ 24h | Scaleway Object Storage |
| Owner report artifacts | restic (volume) | Nightly full | 30 days | ≤ 24h | Scaleway Object Storage |
| Redis | No backup (ephemeral) | N/A | N/A | N/A | N/A |

### Cost estimate (Scaleway, approximate)

| Component | Storage | Monthly cost |
|---|---|---|
| Object Storage (restic backups) | ~50 GB | ~€0.50 |
| Glacier archive (monthly) | ~200 GB | ~€0.40 |
| Managed PostgreSQL (1 instance) | Included in RDB plan | ~€25-50 (depends on plan) |
| **Total** | | **~€26-51/month** |

---

## 7. Accounting-specific recovery

The accounting module (`account_move`, `account_move_line`) has the strictest recovery
requirements. The cold-tier design preserves financial integrity:

### 7.1 What stays hot (never evicted)

- All `account_move` rows in **open fiscal periods** — `cold_eligible_at` is only set
  when `state = posted` AND the period is closed.
- All `account_move_line` rows whose parent move is in an open period.
- Chart of accounts (`account_account`, `account_journal`) — always hot.
- Fiscal period definitions (`account_period`) — always hot.

### 7.2 What gets evicted (cold)

- `account_move` rows in **closed fiscal periods** with `state = posted`.
- Their child `account_move_line` rows.

### 7.3 Recovery for accounting data

| Scenario | Hot (open period) | Cold (closed period) |
|---|---|---|
| SpacetimeDB volume loss | Restore from restic (≤ 1h RPO) | Data is also in PG (≤ 5 min RPO) |
| Postgres loss | Unaffected (hot data is in STDB) | Restore from PG backup (≤ 5 min RPO managed) |
| Both tiers lost | Restore STDB from restic, PG from backup | STDB restore covers hot; PG restore covers cold; merge path reunifies |
| Period re-opened after eviction | Re-hydration procedure brings the row back to STDB (§4) | PG retains the row; no data loss |

### 7.4 Period re-open workflow (the re-hydration path in practice)

If an accountant needs to modify a move in a previously-closed (and evicted) period:

1. The period-close reducer is reversed (period re-opened).
2. The accountant calls the mutation reducer (e.g., `post_credit_note`).
3. The reducer calls `ensure_row_hydrated(ctx, "account_move", move_id)`.
4. The procedure fetches the row from PG via the api-server endpoint.
5. The row is re-inserted into STDB; `cold_eligible_at` is cleared.
6. The reducer applies the credit note mutation.
7. When the period is re-closed, `cold_eligible_at` is re-stamped; the eviction worker
   eventually re-evicts the updated row (upsert via `ON CONFLICT DO UPDATE`).

**Financial integrity preserved:** the move is always in SpacetimeDB when it's being
mutated. The re-hydration is transparent to the mutation reducer's business logic.

---

## 8. What needs to change in `backup-stdb.sh`

The existing `scripts/backup-stdb.sh` script should be updated to:

1. **Add a Postgres backup step** (when `COLD_TIER_ENABLED=true`):
   ```bash
   if [[ "$COLD_TIER_ENABLED" == "true" && -n "$DATABASE_URL" ]]; then
     pg_dump --format=custom "$DATABASE_URL" > "${PREFIX}.cold-tier.dump"
   fi
   ```

2. **Update the manifest** to include the cold-tier dump artifact.

3. **Add a verification step**: after backup, verify the PG dump can be listed:
   ```bash
   pg_restore --list "${PREFIX}.cold-tier.dump" > /dev/null
   ```

4. **Document the native snapshot capability**: update the manifest notes to mention
   that SpacetimeDB now has native snapshot capture (the `spacetimedb-snapshot` crate)
   and that the restic backup captures these snapshots alongside the commit-log.

---

## 9. Open items

1. **Commit-log disk cleanup:** SpacetimeDB snapshots reduce replay time but do not
   truncate old commit-log segments. Verify whether the standalone host automatically
   removes old segments after a snapshot is captured, or if manual cleanup is needed.
   If manual, add a periodic cleanup step (delete segments older than the latest
   snapshot's tx offset). **Measure disk usage growth over a pilot period.**

2. **restic consistency for SpacetimeDB:** verify whether restic's file-level backup of
   the `spacetimedb-data` volume produces a consistent recoverable state when
   SpacetimeDB is running. The commit-log is fsync'd per transaction, but snapshot
   files may be mid-write. Safest approach: use LVM/btrfs snapshots of the Docker
   volume before restic backup, or stop SpacetimeDB during the nightly full.

3. **Managed PG PITR verification:** if using Scaleway Managed PostgreSQL, verify the
   actual PITR RPO (advertised as ≤ 5 min, needs confirmation for the cold-tier
   workload which is append-heavy, low-write).

4. **Re-hydration procedure `unstable` feature:** adding `features = ["unstable"]` to
   the SpacetimeDB dependency may affect the module compilation or behavior. Verify
   the module still compiles and all 624 reducers pass tests with the feature enabled.
   This is a Phase 3 prerequisite.

---

## 10. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-17 | Two-tier backup: restic (hot) + PG-native (cold) | Each tier uses the backup tool best suited to its storage model |
| 2026-08-17 | Rely on SpacetimeDB native snapshots for replay optimization | `spacetimedb-snapshot` crate v1.3.0 confirmed; host loads snapshot + replays suffix automatically |
| 2026-08-17 | Re-hydration procedure confirmed feasible | Official docs verify `ctx.http.get()` + `ctx.with_tx()` in Rust procedures; requires `features = ["unstable"]` |
| 2026-08-17 | Procedures (not reducers) for re-hydration | Reducers are deterministic (no HTTP); procedures are designed for non-deterministic ops + optional transactions |
| 2026-08-17 | Cold tier improves backup story | Smaller hot working set → faster restic backup; PG brings mature PITR for historical data |
| 2026-08-17 | Accounting integrity preserved across tiers | Open-period moves never evicted; closed-period moves recoverable from PG; re-hydration brings rows back for mutation |
