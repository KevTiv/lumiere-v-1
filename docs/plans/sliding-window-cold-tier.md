# Sliding-window hot/cold storage tier (SpacetimeDB → Postgres)

**Status:** Proposed — revised 2026-08-18 after architecture review
**Tracks:** `storage-tier`, `production-readiness`, `horizontal-scaling-investigation`
**Related:** [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [offline-changeset-sync.md](./offline-changeset-sync.md)

---

## 1. Decision

Use SpacetimeDB as the authoritative hot transactional engine and Postgres as a generated cold projection for historical rows, but only behind explicit safety invariants.

The original direction remains valid, but implementation must not begin from a generic “fan out two SQL queries and merge JSON” model. The cold tier must preserve the same authorization, company scope, field projection, ordering, pagination, row-version, and recovery semantics as the hot tier.

### Non-negotiable invariants

1. **SpacetimeDB remains authoritative for business decisions and writes.**
2. **Postgres is a generated projection, not a second business engine.**
3. **No STDB row is deleted until the exact archived version is durably present in PG.**
4. **All cold reads use the same resolved read contract as hot reads.** No independent PG authorization or filter logic.
5. **Re-hydration is orchestrated before a normal reducer call.** A reducer does not call a procedure and then continue its transaction.
6. **Archive-capable reads must be bounded.** Millions of cold rows must never be merged into one unbounded API response.
7. **Cross-tier recovery must be provable.** Independent backups are insufficient without an archive transfer ledger/watermark.
8. **Frontend compatibility is a goal, not permission to weaken semantics.** Existing callers remain unchanged where the server can preserve the exact contract; transactional resources may require pagination work before archival is enabled.

---

## 2. Why this is needed

Alpha tenants may import 5–10 years of POS, sales, stock, and accounting history. Keeping all historical transactional rows in SpacetimeDB's in-memory working set is unnecessary and can increase memory pressure and restart/replay cost.

Initial archive candidates:

- `pos_order`, `pos_order_line`, `pos_payment`
- `sale_order`, `sale_order_line`
- `stock_move`
- `account_move`, `account_move_line` for closed periods only
- `audit_log` as a special first workload

Master/reference tables, active workflow rows, permissions, org/auth data, fiscal configuration, chart-of-accounts data, and other frequently referenced state remain hot.

---

## 3. Schema/codegen architecture

### 3.1 Source-of-truth chain

Cold-tier schema generation must be server-side and derive from SpacetimeDB-generated **Rust** bindings, not generated TypeScript files.

```text
SpacetimeDB Rust module definitions
        │
        ▼
spacetime generate --lang rust
        │
        ▼
api-server/src/stdb_sdk_bindings/
        │
        ▼
lumiere-codegen
        │
        ▼
GeneratedSchemaManifest / schema IR
        ├── PG DDL + migrations
        ├── STDB ↔ PG serialization metadata
        ├── archive metadata
        ├── generated read-plan metadata
        └── generated hydration metadata
```

SpacetimeDB-generated Rust bindings mirror module table types and expose server-side representations such as `u64`, `Option<Timestamp>`, enums, `Identity`, and `Vec<T>`. Generated `*_table.rs` bindings expose table identity and index/primary-key information.

Do **not** make downstream generators parse TypeScript to recover database types.

### 3.2 Stable Lumiere schema IR

Generated Rust source is an input, not the public schema API for every generator. `lumiere-codegen` normalizes the generated bindings into one stable internal manifest:

```rust
pub struct GeneratedTableSchema {
    pub table: String,
    pub primary_key: GeneratedPrimaryKey,
    pub columns: Vec<GeneratedColumn>,
    pub indexes: Vec<GeneratedIndex>,
}

pub struct GeneratedColumn {
    pub name: String,
    pub ty: GeneratedType,
    pub nullable: bool,
}

pub enum GeneratedType {
    U64,
    I64,
    U32,
    F64,
    Bool,
    String,
    Timestamp,
    Identity,
    Vec(Box<GeneratedType>),
    Enum(String),
    Struct(String),
}
```

Every cold-tier generator consumes this IR. PG DDL, codecs, read projection, migration logic, archive metadata, and hydration metadata must not independently parse generated source.

### 3.3 Type mapping rule

Postgres `BIGINT` is signed. It is not a lossless representation of the full Rust `u64` domain.

The schema IR must make this explicit. Choose one of:

- `NUMERIC(20,0)` for full `u64` fidelity;
- a checked `BIGINT` mapping with a repository-wide invariant that IDs never exceed `i64::MAX`;
- text/decimal representation where interoperability requires it.

Never silently coerce malformed or out-of-range IDs to `0`.

### 3.4 CI gate

`make check-codegen` must fail when:

- Rust bindings drift from the SpacetimeDB module;
- schema IR drifts from generated Rust bindings;
- PG DDL/migrations drift from schema IR;
- archive/hydration manifests reference missing tables, columns, reducers, or primary keys.

---

## 4. Shared read contract

### 4.1 One read plan, two compilers

Today `query_exec.rs` and `stdb-auth` resolve organization/company scope, field-access projection, resource-specific predicates, and ordering. Cold reads must reuse that resolution rather than independently querying PG.

Introduce a store-agnostic read plan:

```rust
pub struct ResourceReadPlan {
    pub resource: ResourceKey,
    pub table: TableName,
    pub projection: Vec<ColumnName>,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub predicates: Vec<ReadPredicate>,
    pub order: Vec<ReadOrder>,
    pub page: PageSpec,
}
```

Flow:

```text
authenticated request
  ↓
resolve session + org/company + field policy
  ↓
ResourceReadPlan
  ├── compile to STDB SQL
  └── compile to PG SQL
  ↓
merge already-equivalent row shapes
```

The plan is the single source of truth for:

- organization isolation;
- company isolation;
- field-level access;
- soft-delete/archive filters;
- resource-specific predicates;
- ordering;
- cursor/limit semantics.

### 4.2 Predicate correctness

Never inject an unparenthesized predicate such as:

```sql
organization_id = ? AND cold_eligible_at IS NULL OR cold_eligible_at >= ...
```

Represent it structurally, or compile it as:

```sql
organization_id = ?
AND (
  cold_eligible_at IS NULL
  OR cold_eligible_at >= ...
)
```

### 4.3 Pagination is a prerequisite

Do not enable transactional cold reads for a resource whose API contract can return an unbounded historical set.

Before a resource enters Phase 2:

- inventory every frontend/server consumer;
- define deterministic order keys;
- define cursor/limit semantics across both stores;
- ensure a merged page is globally ordered and bounded;
- add frontend pagination only where required.

The cold tier must not move the memory problem from SpacetimeDB into the API server or browser.

### 4.4 Merge semantics

For a bounded page:

1. resolve one `ResourceReadPlan`;
2. query hot and cold stores concurrently where the requested page may span both;
3. normalize using generated codecs;
4. dedupe by primary key and archive version, preferring the current STDB row;
5. globally sort;
6. apply the final page boundary once, after merge.

A unified HTTP response cannot return hot rows and then later append cold rows. If partial-result behavior is desired, it requires an explicit API/frontend contract.

---

## 5. Archive eligibility and row versioning

Each archive-capable transactional table gains:

```rust
pub cold_eligible_at: Option<Timestamp>,
pub archive_version: u64,
```

`archive_version` increments whenever a change affects the archived representation.

Reducers remain responsible for eligibility. The worker never derives business/fiscal state independently.

Examples:

| Resource | Eligible when |
|---|---|
| POS order | terminal paid/invoiced/cancelled state |
| Sale order | `done` / `cancel` |
| Stock move | `done` and otherwise safe to archive |
| Account move | posted **and** fiscal period closed |
| Child rows | parent eligible and child version stable |

---

## 6. Safe eviction protocol

The original read → PG insert → unconditional STDB delete sequence is unsafe because a row can change between the worker read and delete.

Use compare-and-finalize semantics.

### 6.1 Worker flow

```text
1. Read eligible STDB rows including:
   id, organization_id, cold_eligible_at, archive_version, full payload

2. UPSERT exact version into PG.

3. Verify PG contains (id, archive_version, payload hash/checksum).

4. Call an internal STDB finalize reducer with:
   table, id, expected_archive_version, expected_cold_eligible_at

5. Finalize reducer atomically re-reads the row and deletes only if:
   - id still exists;
   - archive_version is unchanged;
   - cold_eligible_at is unchanged;
   - row remains eligible.

6. If any check fails, do not delete. Retry from the new STDB version later.
```

The worker must never mutate STDB rows through ad-hoc SQL. Final deletion is a reducer transaction.

### 6.2 PG UPSERT

`ON CONFLICT DO NOTHING` is insufficient after rehydration.

Use version-aware generated UPSERT semantics:

```sql
ON CONFLICT (id) DO UPDATE
SET ...,
    archive_version = EXCLUDED.archive_version,
    archived_at = now()
WHERE EXCLUDED.archive_version > cold_table.archive_version;
```

### 6.3 Transfer ledger

Persist an `archive_transfer` record containing at least:

- resource/table;
- row id;
- organization id;
- archive version;
- payload hash;
- PG transfer timestamp;
- STDB finalize timestamp/transaction identifier where available.

This ledger supports auditability and disaster-recovery validation.

---

## 7. Re-hydration for late mutations

A reducer cannot detect a missing row, call an external-data procedure, and then continue the same already-running reducer transaction.

Re-hydration is orchestrated **before** the normal reducer call.

### 7.1 Generated hydration policy

Generate metadata for reducers that may target archived rows:

```rust
pub struct ReducerHydrationPolicy {
    pub reducer: &'static str,
    pub table: &'static str,
    pub id_arg: ReducerArgPath,
}
```

### 7.2 API call flow

```text
frontend
  ↓ unchanged
POST /api/call/:reducer
  ↓
api-server resolves ReducerHydrationPolicy
  ↓
if target row is absent from STDB:
    call generated SpacetimeDB hydration procedure
      1. HTTP GET cold row from internal api-server endpoint
      2. open procedure transaction
      3. insert row if still absent
      4. clear cold_eligible_at
      5. preserve/increment archive_version by generated rule
  ↓
api-server calls original reducer normally
```

The hydration procedure only hydrates. It does not attempt to call back into an already-running reducer transaction.

The hydration transaction must be idempotent because procedure transaction closures may be retried.

### 7.3 Stale PG copy while hot

PG may retain the previous cold version while the row is hot again. Read merge prefers the current STDB row/version. Re-eviction performs version-aware PG UPSERT before finalizing STDB deletion.

---

## 8. Audit log specialization

Audit log is the first workload, but the existing `audit_log` table itself acts as the durable transactional outbox rather than adding a second JSON queue.

This proves:

- Rust-binding → schema-IR → PG DDL generation;
- PG TLS/pooling;
- transfer/finalize mechanics;
- PG read path;
- cross-tier observability;
- backup/recovery ledger;

without first taking on mutable transactional rows.

---

## 9. Postgres client and TLS

Use `tokio-postgres` + `deadpool-postgres` if that remains the lightweight stack, but production managed Postgres must use an actual TLS connector. `NoTls` is development-only.

Configuration must distinguish local and production TLS modes and fail closed when production requires TLS but it is absent.

---

## 10. Failure behavior

| Failure | Required behavior |
|---|---|
| PG read unavailable | Do not silently claim complete historical results. Return explicit degraded/error metadata appropriate to the resource contract. |
| PG archive write fails | Keep STDB row. Retry. |
| Worker crashes after PG write | STDB row remains until checked finalize succeeds. Re-run is idempotent. |
| Row mutates during archive | Finalize reducer rejects stale expected version. New version remains hot. |
| PG has stale older version after rehydration | STDB wins reads; next archive performs version-aware UPSERT. |
| PG schema drift | CI/codegen gate blocks deploy. |
| Hydration PG/API failure | Original mutation is not attempted; return a clear reducer-call error. |

---

## 11. Implementation phases

### Phase 0 — safety foundation

- [x] Generate Rust client bindings for api-server from the SpacetimeDB module (manual step: `make generate-stdb-rust-sdk`, requires the SpacetimeDB CLI + a running module — not yet gated by `make check-codegen`, see note below).
- [x] Add schema-IR extraction from generated Rust bindings.
- [x] Generate PG DDL/codecs from schema IR.
- [x] Add `ResourceReadPlan` and STDB/PG compilers.
- [x] Add generated archive/hydration manifests.
- [x] Define archive-version and payload-hash conventions.
- [x] Add production PG TLS configuration.
- [x] Define global cursor/ordering contract and audit each archive candidate's consumers.
- [x] Extend `make check-codegen`.

**Exit gate:** no archive-capable code relies on TS parsing, independent PG authorization logic, silent type coercion, or unbounded merge behavior.

Phase 0 deliverables live in:

- `lumiere-codegen/src/{schema_ir,stdb_bindings_parse,pg_ddl_emit,codec_emit,archive_manifest_emit,hydration_manifest_emit}.rs`
- `api-server/src/cold_tier/{mod,conventions,cursor,pg_pool}.rs`
- generated assets: `crates/stdb-auth/assets/{lumiere-schema-manifest,archive-manifest,codec-manifest,hydration-manifest}.json`
- generated DDL: `api-server/src/generated/pg_ddl/cold_audit_log.sql`
- config: `lumiere-codegen/{archive-candidates,hydration-policies}.json`

Note: `make generate-stdb-rust-sdk` regenerates `api-server/src/stdb_sdk_bindings/` (requires the SpacetimeDB CLI + module); `make codegen` then derives every downstream artifact from those bindings. `make check-codegen` only verifies that the derived artifacts match the *currently committed* bindings — it does **not** re-run `generate-stdb-rust-sdk` against the live module, so it cannot catch drift between the deployed SpacetimeDB schema and the committed bindings. Whoever changes the module schema must run `make generate-stdb-rust-sdk && make codegen` and commit the result; this is not yet CI-enforced.

### Phase 1 — audit log cold path

Implement the dedicated audit plan using existing `audit_log` as the transactional outbox.

**Exit gate:** audit rows reach PG, are verified, and are removed from STDB only through checked finalize logic; reads remain correctly scoped.

### Phase 2 — first mutable transactional resource

Start with one resource after consumer/pagination audit:

- [ ] `cold_eligible_at` + `archive_version`;
- [ ] reducer-owned eligibility stamping;
- [ ] generated PG schema/codecs;
- [ ] worker UPSERT + verify;
- [ ] version-checked STDB finalize reducer;
- [ ] shared dual-store read page;
- [ ] mutation rehydration policy where required;
- [ ] concurrency/failure integration tests.

Do not expand until this resource survives load, crash, mutation-race, authorization, and restore tests.

### Phase 3 — remaining resources + operations

- [ ] expand resources one by one;
- [ ] per-org windows;
- [ ] backlog/status/dry-run admin APIs;
- [ ] metrics and alerts;
- [ ] human-approved AI action-draft surface;
- [ ] pilot runbook.

### Phase 4 — scaling decision

Measure actual SpacetimeDB memory/restart behavior and evaluate per-org sharding/native scaling alternatives. Treat the cold tier as reversible architecture.

---

## 12. Required tests

- tenant A cold rows never appear for tenant B;
- company-private cold rows respect the same company scope as hot rows;
- field permissions produce the same projection from both stores;
- global order/cursor is correct across hot/cold;
- PG failure does not masquerade as a complete historical result;
- mutation between worker read and finalize cannot lose the newer version;
- worker crash after PG write is idempotent;
- rehydrated row can mutate and later re-archive with a newer PG version;
- stale PG version never overrides hot STDB data;
- schema/codegen drift fails CI;
- restore test proves every finalized STDB deletion is recoverable from the selected PG recovery point.

---

## 13. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-17 | Use SpacetimeDB hot + Postgres cold | Historical imports may exceed a comfortable hot working set. |
| 2026-08-18 | Generate cold metadata from SpacetimeDB-generated Rust bindings | Server-side generated types are a more coherent schema input than frontend TS artifacts. |
| 2026-08-18 | Normalize generated Rust into a stable Lumiere schema IR | Downstream generators should not each parse generated source. |
| 2026-08-18 | Shared `ResourceReadPlan` for STDB and PG | Prevents authorization/company/field/filter drift. |
| 2026-08-18 | Pagination is a precondition for transactional archival | Prevents moving the memory problem into API/browser. |
| 2026-08-18 | Version-checked finalize reducer | Prevents data loss when a row mutates during archival. |
| 2026-08-18 | Version-aware PG UPSERT | Supports rehydration and re-archival. |
| 2026-08-18 | API-orchestrated hydration before reducer call | Avoids invalid reducer→procedure→continue control flow. |
| 2026-08-18 | Cross-tier transfer ledger required | Independent backups need a provable common recovery boundary. |
| 2026-08-18 | Keyset cursors, not offset, for cold pagination | Rows move hot→cold between requests; offset is unstable, keyset predicates on the last seen key value. |
| 2026-08-18 | Hydration manifest is codegen-validated even when empty | The generator + CI gate exist in Phase 0; Phase 1 audit_log is append-only so the policy list is empty. |
| 2026-08-18 | u64 order-key cursors encoded as decimal strings | Lossless round-trip across the JSON-based cursor format (matches the API JSON representation for U64 columns). |
