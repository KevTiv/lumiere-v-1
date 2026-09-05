# Audit-log cold-by-default: superseded historical proposal

**Status:** Superseded by the C5 policy correction (2026-09-05)
**Tracks:** `storage-tier`, `audit`, `production-readiness`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [backup-recovery-followup.md](./backup-recovery-followup.md)

> This document records the earlier audit-log cold-tier design and is retained
> for decision history. It is not an active implementation contract. The
> current C5 policy has exactly one archive root: `pos_order` (with its reviewed
> children). `audit_log` is `always_hot` because ordinary audit appends do not
> emit the exact organization commit and projection-watermark evidence needed
> for safe deletion. The compatibility `cold_audit_log` schema/read path and
> migration remain available for already-archived development data, but no
> active audit drainer or audit finalizer is part of the archive candidate set.

---

## 1. Historical decision (superseded)

Use the existing SpacetimeDB `audit_log` table itself as the short-lived transactional outbox for Phase 1.

Do **not** introduce a second `audit_forwarder_queue` JSON table.

The existing audit helper already transactionally inserts the complete immutable audit row, including the canonical SpacetimeDB-generated audit ID. Reusing it avoids:

- duplicating the audit payload in another table;
- introducing queue-id versus audit-id ambiguity;
- changing 1,000+ call sites;
- JSON parse/default coercion risk;
- claiming a “tiny” queue when the payload still contains full old/new audit data.

The desired behavior is therefore **hot for seconds, cold for history**, not “never present in STDB at all.”

---

## 2. Architecture

```text
business reducer
  ↓
existing write_audit_log_v2(...)
  ↓
STDB audit_log insert
  │ complete, canonical, transactional AuditLog row
  ↓
api-server audit drainer
  ↓
generated PG UPSERT into cold_audit_log
  ↓
verify exact id/payload
  ↓
internal finalize reducer deletes that exact STDB audit row
```

Read path:

```text
GET /api/query/audit-log
  ↓
resolve normal auth/company/field read policy
  ↓
query PG historical audit
query STDB undrained tail
  ↓
dedupe/order id DESC
  ↓
LIMIT 500 (or normal future cursor)
```

This means a just-created audit row is visible even if the PG drainer is delayed.

---

## 3. Why existing `audit_log` is the correct outbox

`audit_log` is already:

- inserted in the same transaction as the business mutation;
- append-only;
- immutable after creation;
- canonically identified by its STDB auto-increment ID;
- represented as a typed Rust `AuditLog` row;
- durable through the normal SpacetimeDB commit log;
- already wired through the existing audit helper/call sites.

A dedicated queue adds another schema, another ID, another serialization layer, and another opportunity for data loss without adding stronger transactional guarantees.

---

## 4. Schema generation

`cold_audit_log` is generated from the same Rust-binding → Lumiere schema-IR pipeline as the general cold tier.

Do not hand-maintain the PG column list and do not derive it from generated TypeScript.

Generated metadata must cover:

- canonical `AuditLog` columns/types;
- PK;
- organization/company scope fields;
- PG DDL/migration;
- STDB → PG codec;
- PG → API JSON codec;
- read projection;
- transfer/finalize metadata.

### ID handling

Never use code resembling:

```rust
payload["id"].as_i64().unwrap_or(0)
```

Missing, malformed, or out-of-range IDs are batch errors. They must never become `0`.

---

## 5. Drainer

Default interval can begin around 5 seconds, but throughput/backoff should be configurable.

Worker flow:

```text
1. Query bounded STDB audit rows ordered by id.
2. Convert typed rows with generated codec.
3. UPSERT into PG using canonical audit id.
4. Verify PG row id + payload checksum.
5. Call internal finalize reducer with exact expected audit id/checksum.
6. Finalize reducer deletes only the matching immutable audit row.
7. Record transfer ledger entry and metrics.
```

Because audit rows are immutable, the version protocol is simpler than mutable transactional resources. A checksum is still useful for recovery validation.

### Multiple workers

If multiple api-server instances may run drainers, processing must be idempotent.

At minimum:

- PG UPSERT is idempotent by audit ID;
- finalize deletion is idempotent;
- duplicate worker claims cannot delete unrelated rows.

A lease/claim mechanism can be added only if measurements show duplicate reads are expensive.

---

## 6. Read path and authorization

Do not replace the existing audit query with a PG-only:

```sql
SELECT * FROM cold_audit_log
WHERE organization_id = $1
```

Cold audit reads must compile from the same `ResourceReadPlan` used for the hot path.

The API merges:

- PG historical rows;
- any STDB rows not yet finalized.

Apply:

- org/company isolation;
- field policy;
- deterministic ordering;
- final `LIMIT 500`/cursor after merge.

If PG is unavailable, returning only the STDB tail is **not** a complete audit history. The response must explicitly fail or identify degraded/incomplete historical data according to the API contract.

### 6.1 Consumer inventory (Phase 0 audit)

The existing `audit-log` read contract is already bounded, so it is safe to
enable cold reads without first adding a cursor. The inventory:

| Consumer | Location | Contract used |
|---|---|---|
| Server read path | `api-server/src/query_exec.rs` `audit-log` arm | `SELECT … FROM audit_log WHERE organization_id = ?`; then `sort_rows_by_id_desc`; then `truncate(500)`. No cursor, no pagination params, no `company_id` filter in SQL (company visibility is enforced by field projection). |
| Settings audit panel | `frontend/packages/ui/src/settings/audit-log.tsx` → `useAuditLog` | `GET /api/query/audit-log`, no query params. Renders the 500-row result with client-side search/action-filter and CSV export. |
| Per-record audit tab | `frontend/packages/ui/src/entity-views/record-audit-tab.tsx` → `useAuditLog` | Same endpoint and same 500-row page, filtered client-side by `table_name` + `record_id`. |

Findings:

1. Both frontend consumers call the same single endpoint and rely on the
   latest 500 rows by `id DESC`. No consumer passes a cursor today.
2. The per-record tab relies on the relevant audit rows being within the
   latest 500. This is a **pre-existing** limitation, not introduced by the
   cold tier; the cold merge must preserve it exactly (top 500 by `id DESC`
   across PG ∪ STDB tail, deduped by id, STDB preferred).
3. The `ResourceReadPlan` for `audit-log` is therefore:
   `order = [id DESC]`, `limit = 500`, `cursor = None`. The global cursor
   contract (`api-server/src/cold_tier/cursor.rs`) is defined but unused for
   Phase 1; it exists so future mutable resources can adopt keyset pagination
   without changing the encoding.

---

## 7. Failure behavior

| Failure | Behavior |
|---|---|
| PG unavailable | Audit rows remain in STDB; drainer retries. |
| Drainer crashes after PG UPSERT | Row remains in STDB until finalize; rerun is idempotent. |
| Finalize reducer fails | Keep row in STDB; retry finalize. |
| PG read unavailable | Do not silently return “complete” audit history from STDB tail. |
| Malformed codec/type | Fail the batch/item loudly; never coerce fields to defaults. |
| STDB backlog grows | Alert on row count/oldest-row age; no audit data loss. |

---

## 8. Metrics

Expose at least:

- `audit_cold_forwarded_total`
- `audit_cold_forward_failures_total`
- `audit_cold_finalize_failures_total`
- `audit_cold_backlog_rows`
- `audit_cold_oldest_row_seconds`
- `audit_cold_batch_duration_seconds`
- `audit_cold_read_failures_total`

---

## 9. Phase 1 implementation

### Codegen

- [ ] generate Rust bindings from STDB module;
- [ ] normalize `AuditLog` into Lumiere schema IR;
- [ ] generate `cold_audit_log` PG schema;
- [ ] generate codecs/read metadata.

### PG

- [ ] actual production TLS connector;
- [ ] connection pool;
- [ ] generated migration/indexes;
- [ ] idempotent UPSERT.

### STDB/API

- [ ] keep `write_audit_log_v2` behavior unchanged;
- [ ] add audit drainer;
- [ ] add checked audit finalize reducer;
- [ ] add transfer ledger;
- [ ] modify audit read path to merge PG + STDB tail using the shared read plan.

### Tests

- [ ] audit business mutation + audit insert are still one STDB transaction;
- [ ] PG down causes backlog, not loss;
- [ ] crash after PG write is safe;
- [ ] duplicate drain is idempotent;
- [ ] latest undrained events appear in reads;
- [ ] org/company/field scoping is identical across PG/STDB;
- [ ] malformed IDs cannot collapse to `0`;
- [ ] restore drill validates transferred audit rows.

---

## 10. Exit criteria

Phase 1 is complete when:

1. no audit call site has changed;
2. every audit row is created transactionally in STDB;
3. every finalized deletion has a verified PG counterpart;
4. PG + STDB-tail reads produce one correctly authorized ordered view;
5. PG outages create backlog/alerts but no loss;
6. cold schema/codecs are generated from the Rust schema IR;
7. a real restore exercise proves the transfer ledger.
