# Backup & recovery follow-up: hot/cold tier

**Status:** Proposed — revised 2026-08-18 after architecture review  
**Tracks:** `storage-tier`, `backup-restore`, `production-readiness`  
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md)

---

## 1. Core recovery principle

The hot/cold split creates a distributed recovery boundary.

Backing up SpacetimeDB and Postgres independently is necessary but **not sufficient**. A row can be copied to PG and then removed from STDB; restoring STDB to a point after that deletion while restoring PG to a point before that insert can leave the row in neither store.

Therefore:

> No cold-tier deletion is considered recoverable unless the archive transfer is represented by a verifiable transfer ledger/watermark and recovery procedures validate both tiers against it.

---

## 2. Tier responsibilities

| Tier | Store | Data | Recovery mechanism |
|---|---|---|---|
| Hot | SpacetimeDB | active/realtime working set + transient archive backlog | data-volume backup + exact-version-supported snapshot/restart behavior |
| Cold | Postgres | finalized historical projection | managed PITR preferred; full logical backups as secondary |
| AI/RAG | Qdrant | derived vectors | snapshot/backup or rebuild from source |
| Artifacts | filesystem/object storage | generated reports/files | regular object/volume backup |

---

## 3. Archive transfer ledger

Every finalized archive stores:

```text
resource
row_id
organization_id
archive_version
payload_hash
pg_committed_at
stdb_finalized_at
stdb_tx_identifier/offset if safely available
```

The ledger may live in PG if it is durable under the same PITR regime, with enough STDB finalize information to audit the boundary. An additional compact STDB checkpoint/watermark can be used if recovery testing proves it useful.

### Recovery invariant

For every STDB deletion visible at the chosen hot recovery point, the selected PG recovery point must contain the corresponding archive version.

Recovery automation must check this invariant before traffic is enabled.

---

## 4. SpacetimeDB backup assumptions

Do not encode undocumented operational assumptions as guarantees.

Before production:

- verify snapshot creation/restoration behavior against the exact pinned SpacetimeDB version/image;
- verify restart from backed-up data in a clean environment;
- measure commit-log replay duration;
- document the actual filesystem/data paths;
- do not manually delete commit-log segments unless the exact pinned SpacetimeDB version provides a supported truncation/GC procedure and a restore drill proves it safe.

The commit log is part of durability/history. “Older than latest snapshot” is not by itself sufficient authorization to delete a segment.

### Required hot-tier restore drill

1. restore the backed-up STDB data directory onto a clean host;
2. start the exact production SpacetimeDB version;
3. verify module/data health;
4. record restored transaction position/timestamp as precisely as the supported tooling allows;
5. run cross-tier transfer validation before enabling writes.

---

## 5. Postgres backup

### Preferred production mode

Use managed PostgreSQL with:

- automated backups;
- PITR/WAL archiving;
- TLS;
- monitored retention;
- periodic restore drills into isolated instances.

### Self-hosted mode

Use:

- regular full logical dump (`pg_dump --format=custom`) for portability;
- WAL archiving / physical base backup for incremental/PITR behavior.

`pg_dump` itself is a full logical backup. Do not describe `pg_dump --format=custom` as an incremental backup mechanism.

---

## 6. Cross-tier restore procedure

A recovery is not complete when both databases merely start.

```text
1. Select STDB recovery point S.
2. Restore STDB.
3. Determine the corresponding transfer/finalize horizon visible at S.
4. Select a PG PITR point P that is at least new enough to contain every finalized transfer visible at S.
5. Restore PG to P.
6. Run transfer-ledger verification:
   for each finalized archive visible at S:
      PG must contain same resource/id/version/hash.
7. Check duplicate cases:
   a row present in both STDB and PG is tolerable;
   read merge must prefer the newer STDB version.
8. Missing-in-both is fatal.
9. Only then enable normal application traffic.
```

A recovery target should prefer **duplicates over gaps**. Duplicate copies can be reconciled; missing rows cannot.

---

## 7. Rehydration and backups

Rehydration is API-orchestrated before the normal reducer call.

```text
api-server sees reducer target missing in STDB
  ↓
call hydration procedure
  ↓
procedure fetches cold row over authenticated internal HTTP
  ↓
procedure opens STDB transaction and inserts if still absent
  ↓
normal reducer call proceeds
```

A rehydrated row remains represented by its older PG copy until it is re-archived. Reads prefer STDB while hot.

When re-archived, PG uses version-aware `ON CONFLICT DO UPDATE`, not `DO NOTHING`.

Backup/recovery tests must cover this sequence:

1. archive v1;
2. hydrate v1;
3. mutate to v2;
4. archive v2;
5. restore both tiers;
6. verify v2 wins and v1 cannot reappear as canonical.

---

## 8. Audit-log recovery

Because the revised audit plan uses STDB `audit_log` as a transient transactional outbox:

- undrained rows are recovered with STDB;
- finalized rows are recovered from PG;
- PG + STDB-tail reads remain valid after recovery;
- transfer ledger verification proves no audit event crossed the boundary without a cold counterpart.

This is stronger than a separate JSON forwarding queue and avoids ambiguous queue IDs.

---

## 9. Recovery objectives

Initial targets remain proposals until benchmarked:

| Data | Candidate RPO | Candidate RTO |
|---|---:|---:|
| Hot STDB working set | ≤ 1h backup loss window; lower if provider snapshot cadence supports it | ≤ 30 min |
| Cold PG | ≤ 5 min with managed PITR | ≤ 30 min |
| Audit | no logical loss for committed rows when cross-tier invariant holds | ≤ 30 min |
| Qdrant | ≤ 24h or rebuildable | ≤ 1h |
| Artifacts | ≤ 24h or regenerable | ≤ 1h |

Do not advertise these as achieved until restore drills have measured them.

---

## 10. Required drills

### Drill A — STDB-only failure

- restore STDB from backup;
- validate startup/replay;
- validate transfer ledger horizon against current PG.

### Drill B — PG-only failure

- restore PG via PITR;
- verify every STDB-finalized transfer still exists;
- validate cold read authorization.

### Drill C — split recovery gap simulation

Explicitly create the dangerous ordering:

```text
T0 PG receives archived row
T1 STDB finalizes deletion
```

Then attempt an STDB restore point after T1 with a PG restore point before T0.

The recovery checker must refuse to declare the system healthy.

### Drill D — rehydration/rearchive

Archive v1 → hydrate → mutate v2 → rearchive v2 → restore → prove v2 canonical.

### Drill E — worker crash points

Crash after:

- STDB read;
- PG UPSERT;
- PG verification;
- before finalize;
- after finalize.

Each restart must be idempotent and preserve data.

---

## 11. Production gates

Before enabling transactional cold-tier eviction:

- [ ] exact pinned SpacetimeDB restore behavior tested;
- [ ] no unsupported/manual WAL or commit-log deletion;
- [ ] PG PITR restore tested;
- [ ] archive transfer ledger implemented;
- [ ] cross-tier recovery checker implemented;
- [ ] split-recovery-gap drill passes;
- [ ] rehydration/rearchive drill passes;
- [ ] runbook includes exact commands and escalation path;
- [ ] RPO/RTO numbers replaced with measured results.
