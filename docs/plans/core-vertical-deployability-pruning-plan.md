# Core vertical deployability and plan-pruning decision

**Status:** Active
**Canonical owner:** Core deployability C0–C11
**Last verified against code:** 2026-09-05 at `fa2bdab09`
**Scope:** Core application and persistence behavior before environment-specific development or production setup
**Excludes:** Cloudflare/Scaleway provisioning, DNS/TLS, managed-service purchase/configuration, production traffic tuning, billing-provider integration, mobile/offline, advanced agent runtime, spatial/3D, and multi-region operation
**Supersedes for near-term sequencing:** the deployability portions of `sliding-window-cold-tier.md`, `regional-stdb-scaleway-durable-foundation.md`, `production-readiness-release-hardening-plan.md`, and the proposed agent/work-program plans

## 1. Decision

Lumiere's deployable core uses this ownership model:

```text
browser
  → Next.js BFF
  → Rust api-server
  → SpacetimeDB reducers and authorized reads
      ├── authoritative business rules and transitions
      ├── authoritative active operational state
      └── ordered projection/change records
             ↓
       PostgreSQL durable projection
          ├── reconstructable business history
          ├── cold/historical query data
          ├── projection cursor and checksums
          └── recovery snapshots/manifests
```

SpacetimeDB is not a disposable cache in the usual sense. It is the authoritative
execution and hot-state layer: reducers are the only business mutation boundary,
and active reads/subscriptions come from STDB. PostgreSQL is the durable,
replayable projection of committed STDB business outcomes. PostgreSQL does not
accept independent business mutations and does not reimplement reducer rules.

The practical recovery invariant is:

```text
accepted reducer operation
  → ordered canonical change is emitted
  → PostgreSQL projection reaches the operation's sequence
  → projection can reconstruct the required STDB active state
```

An API success does not have to wait for PostgreSQL in the first deployable
version, but the system must expose projection lag and stop destructive cooling
when durability is unverified. A strict "durable before success" mode can be
added later only if product requirements justify its latency and availability
cost.

## 2. Current implementation reality

The historical inventory below describes the point at which this plan was
written. The active branch has since implemented the C2 commit stream, C3
projector/observability foundation, C4 migration generation, C5/C6 pilots, and
C7 reconstruction contracts. Those implementations remain subject to the
persisted-data, all-module, release, and CI gates in this document.

### Present

- Browser traffic already follows Next.js → api-server → STDB for ordinary ERP
  reads and mutations.
- STDB reducers own domain mutations and invariants.
- Generated operation descriptors own the frontend named-command operation set.
- A shared `ResourceReadPlan` can compile equivalent bounded STDB and PostgreSQL
  reads.
- PostgreSQL pool/TLS configuration, generated cold-table DDL, transfer ledger,
  checksums, and merged hot/cold read foundations exist.
- `audit_log` has an idempotent STDB → PostgreSQL drainer and finalization path.
- `pos_order` proves the version-aware mutable-resource archive protocol.
- The ERP master tracker records no remaining P0/P1 domain-integrity items,
  although many browser workflows still lack full E2E proof.

### Not present

- PostgreSQL is **not yet a durable projection of the whole ERP**. Generated DDL
  and workers currently cover only `audit_log` and `pos_order`.
- There is no canonical, total per-organization business commit stream covering
  all reconstructable tables.
- There is no production-grade migration history for PostgreSQL; schema setup is
  currently `CREATE ... IF NOT EXISTS`.
- There is no complete per-organization reconstruction command or verified
  STDB-loss recovery test.
- Projection watermark, poison-row quarantine, replay, and operator repair are
  not a complete application-level control surface.
- Query/subscription IR remains incomplete; handwritten query/subscription
  behavior is still a parallel contract surface.
- Contract compatibility and a release manifest for IR/contracts/STDB/PG/web
  are not complete.
- Default CI compiles Playwright tests, but the full-stack workflow suite is a
  separate gate and the ERP tracker still lists numerous open E2E flows.

Therefore the current repository demonstrates the architecture on two resources
but does not yet justify the claim that PostgreSQL can recover the ERP.

## 3. Generalized durable/cold storage is the core program

The generalized storage layer is not an optimization to add after a narrow
business vertical. It is the persistence architecture on which every module
must sit.

The current storage census contains **463 relations**: 458 application
relations plus five organization-scoped persistence/reconstruction protocol
relations. The original application baseline was:

```text
425 carry organization_id directly
 33 do not
  2 are declared archive candidates
  0 have hydration policies
```

The 33 tables without direct organization scope are a schema defect. Indirect
ownership through a parent is useful for relationship validation, but it is not
an adequate substitute for a directly stored `organization_id` on every
persisted table. It makes authorization, projection routing, partition pruning,
reconstruction, deletion, and corruption detection depend on joins that may no
longer be available after cooling.

Even shared reference/configuration rows must have explicit organization
ownership in this application model. If an organization receives a seeded copy
of a country, currency, carrier, or policy definition, that copy belongs to the
organization. Runtime and security rows are also tenant-owned. The organization
root uses its own `id` as `organization_id`; there is no nullable/global escape
hatch in the durable business schema.

Every module therefore needs two related but distinct contracts:

1. **Durable projection coverage:** all durable business state is continuously
   represented in PostgreSQL, including rows that remain hot in STDB.
2. **Cold lifecycle coverage:** every table is explicitly classified as
   always-hot, terminal-window, time-window, projection-only, PG-first,
   ephemeral, or external-reference, with safe cooling/hydration behavior where
   applicable.

“Generalized cold storage for every module” does **not** mean deleting every row
from STDB. Active master/configuration data will often remain always hot. It
means no module has accidental or unclassified persistence behavior, and every
durable row has a PostgreSQL representation and recovery path.

## 4. Smallest deployable system

The first deployable system is one organization, one company, one STDB module,
one PostgreSQL database, and the web/api-server stack. The generalized
projection framework must cover all enabled modules before deployment, while
two complete workflows provide deep end-to-end proof. It must prove:

1. authenticated organization bootstrap;
2. one complete lead-to-cash workflow:
   CRM lead/opportunity → sales order → delivery → invoice → payment;
3. one complete procure-to-pay workflow:
   purchase order → receipt → vendor bill → payment;
4. accounting visibility and audit drill-down for both workflows;
5. generated typed commands and bounded generated reads for every step;
6. realtime refresh for active queues and records;
7. ordered durable projection coverage for every durable table in every enabled
   module;
8. restart/replay/rebuild proof from PostgreSQL into an empty disposable STDB
   module, with full proof for the selected workflows and census/count/checksum
   proof for the remaining modules;
9. cross-organization and cross-company rejection fixtures;
10. a production-mode Next.js build and full browser run against the local
    service topology.

The workflows are the deep behavioral proof, not the boundary of durable
coverage. A module may remain a preview/pilot product surface, but its tables
still require explicit durability, retention, relationship, and restore
classification if the module is enabled.

## 5. Required work

### C0 — Repair organization ownership on every table

**Priority:** P0

- Remove the current 11-table global application allowlist.
- Move global truth for `cold_tier_service_identity`, `password_reset_token`,
  `schema_migration`, `user_credential`, and `user_profile` behind an explicit
  platform-control boundary outside the ERP manifest. Keep only
  organization-owned bindings/projections in the application schema.
- Convert `contact_identity_verification_authority`, `country`,
  `country_pack_definition`, `country_pack_tax_rule`, `currency`, and
  `hr_country_pack_leave_default` to organization-seeded copies.
- For organization-owned child rows, derive `organization_id` from the validated
  parent inside the reducer; do not add a client-editable tenant field.
- For the `organization` root row, enforce `organization_id == id`.
- Replace shared/global reference rows with organization-owned seeded copies or
  explicit organization-specific rows. Do not retain a nullable or sentinel
  “global organization.”
- Update every create, update, seed, import, lifecycle hook, scheduled reducer,
  test fixture, generated binding, query, subscription, index, and UI mapper
  affected by the schema change.
- Add an organization-leading index to every table and organization-leading
  uniqueness for business keys that were previously globally unique.
- Preserve organization ownership on updates from the existing stored row or a
  validated parent. Never accept ownership changes through ordinary patch
  commands.
- Validate all parent/child organization equality before inserts and relation
  changes, including the currently indirect cases such as `pos_order_line`,
  `pos_payment`, `sale_order_option`, `import_job_record`,
  `stock_picking_batch`, form children, and workflow calendar children.
- Write an idempotent backfill/migration for existing rows:
  - derive ownership from an unambiguous validated parent;
  - use the root row's own ID for `organization`;
  - clone/seed formerly shared references per organization and remap dependants;
  - quarantine ambiguous or orphaned rows rather than selecting an arbitrary
    organization;
  - verify zero null, sentinel, orphaned, or cross-organization rows before
    making the field mandatory.
- Change schema/codegen CI to fail when any table lacks a direct, non-null
  `organization_id`.
- Remove the `GeneratedTenantScope::Global` application-table path after the
  migration. Infrastructure-only data that genuinely cannot be tenant-owned
  must live outside the ERP table manifest rather than weaken this invariant.

**Persisted-data proof:**

- create distinctive rows for Org A and Org B for each repaired table;
- query each row directly and prove its exact `organization_id`;
- reject a child whose parent belongs to another organization;
- reject forged tenant input and prove the server-derived value wins or the
  command fails;
- rerun after fresh reads and generated binding regeneration;
- run the backfill against a representative pre-migration snapshot and prove
  `458 / 458` application relations and `5 / 5` protocol relations have direct
  ownership with no unresolved rows.

**Gate:** every one of the 458 application relations and five protocol
relations has a direct non-null `organization_id`, every reducer derives or
preserves it from a trusted source,
all uniqueness/indexes are tenant-aware, persisted backfill verification has
zero unresolved rows, and the generated schema manifest reports no global
tables.

### C1 — Complete the all-table storage census

**Priority:** P0

- Generate a checked-in/released `storage-policy-manifest` entry for all 458
  application relations and all five protocol relations.
- Require each table to declare:
  - module/domain owner;
  - durability class;
  - organization ownership path;
  - company ownership path when applicable;
  - parent/child aggregate boundary;
  - authoritative primary key and version strategy;
  - projection mode (`upsert-current`, `append-history`, `snapshot`,
    `derived-rebuildable`, `ephemeral`, or `external-reference`);
  - hot-retention strategy;
  - cooling eligibility source;
  - dependency behavior;
  - hydration/restore policy;
  - delete/tombstone behavior;
  - PostgreSQL partition/access-path class.
- Fail codegen when any schema table is absent, duplicated, or references a
  missing parent/resource.
- Assert direct organization ownership from C0 for every table; parent ownership
  remains relationship-integrity metadata rather than projection-routing
  fallback.
- Emit module coverage totals in CI so a newly added table cannot bypass the
  durable/cold contract.

**Gate:** `458 / 458` application relations and `5 / 5` protocol relations are
classified, `unclassified = 0`, every relation has direct organization
ownership, and every parent relationship agrees with it.

### C2 — Freeze the ordered persistence contract

**Priority:** P0

- Define one canonical `OrganizationCommit` envelope:
  `organization_id`, monotonic `sequence`, operation ID, correlation ID,
  schema/contract version, timestamp, actor reference, and ordered row changes.
- Define row-change identity, full-row/upsert/delete semantics, and canonical
  checksum encoding.
- Generate PostgreSQL projection metadata and codecs from schema IR. Do not add
  handwritten per-domain projection schemas.
- Define transaction semantics so all row changes from one reducer operation
  share one commit sequence and are projected atomically in PostgreSQL.
- Represent deletes with durable tombstones; absence from a later snapshot is
  not an adequate incremental delete protocol.
- Define aggregate ordering for parent/child writes without pretending STDB has
  relational foreign keys that are not present in generated schema IR.

**Gate:** representative multi-row reducers in every module emit one complete,
ordered commit whose row set matches the committed STDB outcome.

### C3 — Replace archive-only forwarding with a generalized projector

**Priority:** P0

- Generalize the two-resource drainer proof into one manifest-driven projector
  for every `upsert-current` and `append-history` table.
- Persist an idempotent per-organization projection cursor.
- Apply each commit atomically and reject sequence gaps.
- Make retries and duplicate delivery harmless.
- Quarantine malformed/incompatible commits without skipping the gap.
- Expose backlog, oldest unprojected age, current STDB sequence, durable
  sequence, last error, and quarantined sequence.
- Project active and historical rows; do not wait for cooling eligibility before
  making a business outcome durable.
- Keep resource cooling as a separate policy after projection. Projection is
  durability; cooling is hot-working-set management.
- Retire the legacy audit and `pos_order` workers once generic projection parity
  is proven. C3 retains PostgreSQL durability through the manifest-driven
  projector; resource cooling and STDB finalization remain paused until C5.

**Gate:** each enabled module has positive create/update/delete projection
fixtures; kill/restart and duplicate-delivery tests end with identical
PostgreSQL rows and cursor; an injected gap blocks advancement visibly.

### C4 — Generate the PostgreSQL durable schema and migrations

**Priority:** P0

- Replace startup-only `CREATE TABLE IF NOT EXISTS` with versioned,
  checksum-verified migrations.
- Generate durable tables for all applicable schema-manifest tables, not only
  archive candidates.
- Generate tenant-leading indexes and partition declarations from reviewed
  access-path/storage metadata.
- Preserve full `u64`, timestamp, identity, enum, vector, and nested-struct
  codecs with round-trip fixtures.
- Generate additive projection migrations where mechanical and require authored
  migration/backfill policy for destructive or semantic changes.
- Define expand → project/backfill → verify → contract ordering.
- Add a release manifest binding application IR, generated contracts, STDB
  module, PostgreSQL schema, api-server, and web versions.
- Add operation-ID tombstones or operation-shape fingerprints so names/IDs
  cannot be silently reused with new meaning.

**Gate:** current → next → application rollback works without destructive
PostgreSQL downgrade, and incompatible combinations fail closed.

**Implemented evidence:** the real-PostgreSQL compatibility drill starts from
the C3 heap layout, applies the current versioned catalog, applies a simulated
next-release additive migration, and proves the current application can start
again without removing the new relation or its data. A subsequent simulated
contract migration is rejected fail-closed. The same drill round-trips maximum
`u64`, timestamp, identity, enum, vector, and nested-structure values through
the generated PostgreSQL codec. The release manifest binds both the immutable
generated baseline and the application migration-catalog version.

### C5 — Implement module-aware cooling and finalization

**Priority:** P0

**Current status:** Partial. Policy/code-generation, reducer fixtures, the
PostgreSQL ledger, and split worker credentials are implemented. C5 remains
open for the disposable registered-worker STDB-to-PostgreSQL drill and an
immutable generated-contract release.

- Replace the two-entry archive candidate list with the total storage-policy
  manifest; archive candidates become a generated subset.
- Add semantic eligibility for every coolable aggregate:
  state, age/window, open obligations, workflow state, durable watermark, exact
  durable version, and hot dependency checks.
- Cool aggregate roots and children coherently. Never finalize a parent while
  leaving required children/references in an invalid hot state or vice versa.
- Generate finalization wiring from policy metadata, but keep domain-specific
  eligibility checks in reviewed STDB reducer/helper logic.
- Add hydration policies for every coolable mutable aggregate.
- Keep active master/configuration rows always hot unless a separate
  projection/hydration design proves otherwise.
- Treat append-heavy audit, telemetry, usage, execution, and message history as
  explicit PG-first or short-hot-tail classes only where the normal write path
  emits the exact durable commit/watermark evidence required for cooling.

**Gate:** every module has at least one reviewed policy fixture for each storage
class it uses; no row can be deleted from STDB before exact-version durability
and dependency safety are proven.

**Current implementation evidence (2026-09-05 working tree):**

- `lumiere-codegen/storage-policy-manifest.json` contains 463 unique relations;
  every cooling decision carries a `reviewed:` source. The Rust policy validator
  enforces 463-table coverage, direct organization ownership, aggregate/archive
  coherence, semantic eligibility fields, and reviewed fixture coverage. The 29
  fixtures cover every module/storage-class pair currently used by the 22
  modules.
- Archive generation now derives its subset from the total storage policy. The
  current generated staging output has exactly one root candidate: `pos_order`
  (`terminal_window`, versioned). `pos_order_line` and `pos_payment` are
  reviewed children that inherit the parent archive rather than becoming
  independent candidates. The retired independent candidate input has no live
  code path.
- `audit_log` is fail-closed as `always_hot`: its ordinary append paths do not
  yet emit an `organization_commit`/`organization_row_change`, so an exact
  projection watermark cannot be proven. The former finalizer signature is a
  compatibility tombstone that always rejects deletion. The legacy PostgreSQL
  migration and hot+cold read remain available for already archived dev data.
- `spacetimedb/src/core/cold_tier.rs` provides the shared fail-closed gate for
  policy, age/window, terminal state, open obligations, workflow state, hot
  dependencies, rebuildability, durable watermark, archive version, schema
  version, and contract version, with child-first aggregate deletion.
- A reducer fixture asserts that the retired audit finalizer cannot delete a
  hot row and currently compiles with the module test surface. POS fixtures
  cover exact archive version, the thirty-day terminal
  window, non-terminal state, open
  obligations, active workflow, missing child membership, watermark/schema
  mismatch, idempotency, and caller identity; the POS grouped suite passed on
  a freshly published disposable local STDB database before this fail-closed
  policy correction.
- `api-server/src/cold_tier/finalization_worker/` parses the pinned archive
  manifest, rejects unknown table/reducer/mode mappings, sorts deterministically,
  dispatches reviewed handlers, and aggregates per-candidate statistics. Its
  focused tests cover parsing, closed dispatch, duplicate rejection, ordering,
  and stats aggregation.
- The projection worker now requires distinct `STDB_SERVER_TOKEN` and
  `STDB_FINALIZATION_TOKEN` credentials. Private commit/source reads use the
  administrator client; finalizer reducer calls use only the registered worker
  client, and startup fails closed when either token is missing or equal.
- `scripts/c5-finalization-drill.sh` and its ignored Rust live test install a
  disposable PostgreSQL database, project a real hydrated POS aggregate, invoke
  the finalizer with the registered worker identity, and verify child/root
  removal, the cold checksum row, and the finalized transfer ledger.
- The archive-transfer ledger uses compare-and-set identity, bounded pending
  reads, crash reconciliation, and explicit schema verification. Real
  PostgreSQL tests prove the normal retry/finalize path and fail closed when a
  malformed pre-existing ledger is encountered.
- `scripts/bootstrap-storage-policies.mjs` now reproduces the reviewed source,
  including reviewed fixtures and semantic/archive metadata; `--check` passes.

**Remaining C5 evidence/blockers:**

- Publish an immutable `lumiere-contracts` release containing the updated
  463-table reviewed provenance and one-root archive subset, then move the
  `Cargo.toml:21` pin from v0.3.29 and verify release fingerprints. The pinned
  v0.3.29 artifact predates the C5 provenance ratchet and still lists the now
  ineligible audit archive candidate.
- Run disposable STDB + PostgreSQL runtime fixtures through the registered
  finalization worker identity, proving archive write/checksum/version/watermark
  durability before reducer deletion for the POS aggregate. The test harness is
  implemented and fails closed without distinct credentials; a live run is
  still required.

### C6 — Generalize bounded hot+cold reads and hydration

**Priority:** P0

- Move all historical/archive-capable resources through the shared
  `ResourceReadPlan`.
- Generate equivalent STDB and PostgreSQL predicates, scope, projection,
  ordering, cursor, partition expectation, and access-path validation.
- Merge hot and cold pages deterministically without duplicates or skipped
  records at the boundary.
- Require direct organization scope and resolve company scope before issuing
  PostgreSQL reads.
- Hydrate cooled mutable aggregates idempotently before invoking existing
  reducer logic.
- Ensure hydration validates organization, company, placement generation,
  schema version, row version/checksum, and complete aggregate membership.
- Prevent arbitrary PostgreSQL resource names, SQL, store selection, or
  hydration payloads from reaching this boundary.

**Gate:** representative current, boundary, fully cold, and rehydrated reads pass
for every module; hot/cold result parity holds at a declared watermark.

### C7 — Reconstruction and reconciliation

**Priority:** P0

- Implement an idempotent per-organization reconstruction command that targets
  an empty disposable STDB module.
- Add explicit relationship/aggregate metadata because the current generated
  schema IR contains tables, columns, primary keys, and indexes but no complete
  foreign-key graph.
- Rebuild reference/configuration rows before dependent operational rows using
  generated and reviewed restore ordering.
- Fence writers during restore and resume only after sequence/checksum
  validation.
- Add a reconciliation command comparing PostgreSQL projection state with STDB
  active rows at a declared watermark.
- Verify deletes, immutable snapshots, relation IDs, totals, audit links, and
  idempotency keys.
- Document state intentionally recreated rather than restored, such as presence
  and live connection state.

**Gate:** wipe disposable STDB state, reconstruct all enabled modules from
PostgreSQL, match per-table counts/checksums at the durable watermark, rerun
module persisted-data assertions, and continue both selected workflows without
duplicate or missing business effects.

### C8 — Finish application contract convergence

**Priority:** P0

- Promote application IR v2 and classify idempotency, semantic kind,
  authorization scope, codecs, and query contracts for vertical operations.
- Implement generated bounded query descriptors and the common query compiler
  for every archive-capable resource.
- Implement generated subscription descriptors for active queues and record
  views; subscriptions remain hot-state contracts rather than unbounded
  historical feeds.
- Remove corresponding handwritten resource SQL, subscription SQL, positional
  calls, duplicate DTOs, and local cache-key/invalidation declarations.
- Keep server-derived organization/actor context out of client inputs.

**Gate:** storage-aware operation/query/subscription census has
`unclassified = 0`; drift checks fail for any handwritten bypass.

### C9 — Security and tenant-isolation proof

**Priority:** P0

- Resolve actor, organization, company, permissions, and field policy once into
  a trusted operation/read context.
- Run adversarial Org A/Org B and Company A1/A2 fixtures through commands,
  reads, subscriptions, projection, cold reads, and reconstruction.
- Prove that known foreign IDs, stale sessions, forged organization fields, and
  cross-company relations fail at the server/STDB boundary.
- Inventory service identities and ensure the projector has only the reducers
  and PostgreSQL privileges it requires.
- Ensure audit identity and correlation fields are server-derived.

**Gate:** all positive persisted-data checks and negative isolation cases pass
after fresh reads and after reconstruction.

### C10 — Workflow and failure-path completion

**Priority:** P0 for selected vertical; P1 for other enabled modules

- Complete Playwright workflows for lead-to-cash and procure-to-pay.
- Assert persisted values and related-record labels after browser refresh, not
  only toasts or mocked calls.
- Add failure tests for missing configuration, insufficient stock, duplicate
  requests, invalid lifecycle transitions, STDB unavailable, PostgreSQL
  unavailable, and projector lag.
- Define degraded behavior:
  - PostgreSQL unavailable: active ERP may continue for a bounded period, no
    cooling, lag is unhealthy and visible;
  - STDB unavailable: writes and hot reads fail closed; PostgreSQL is not a
    writable failover business engine;
  - AI unavailable: ordinary ERP remains available.
- Run the Next.js production build and Playwright against `next start`.

**Gate:** both workflows and degraded-mode tests are green in a disposable local
topology.

### C11 — App-level operability before infrastructure setup

**Priority:** P1

- Add `/live`, `/ready`, and dependency diagnostics with distinct STDB,
  PostgreSQL, projection-lag, contract-version, and migration states.
- Emit structured correlation/release/operation IDs.
- Add bounded projector retry, backoff, and poison-commit behavior.
- Define local synthetic checks for auth/bootstrap, representative read/write,
  realtime refresh, and durable watermark advancement.
- Add concise runbooks for projection lag, blocked sequence, reconstruction,
  incompatible release, and STDB/PG unavailability.

**Gate:** an operator can identify and recover each injected failure without
editing database rows manually.

## 6. Explicitly deferred from deployability

These are valuable but do not block the first deployable core:

- agent capability registry, model routing, sandbox Python, work programs, and
  generated presentation tools;
- semantic search migration from Qdrant to PostgreSQL;
- mobile/Expo, offline changesets, and reconnect conflict resolution;
- multi-region cells, organization migration between cells, and active-active;
- file/object-storage ingestion beyond safe placeholder/reference behavior;
- billing providers and entitlement lifecycle;
- IoT edge, fleet telemetry depth, spatial/3D inventory;
- 100/500/1,000-client performance certification before a measured baseline
  exists.

Deferred features must not be required for ordinary ERP startup or availability.

Generalized module-wide durable projection, storage classification, safe cooling,
bounded historical reads, hydration, and reconstruction are explicitly **not
deferred**.

## 7. Plan pruning

### Keep as canonical

- This document: near-term core sequencing and deployability gate.
- `ARCHITECTURE.md`: current request/service topology.
- `MVP_WORKFLOW_CONTRACT.md`: user-observable workflow acceptance.
- `erp-production-readiness-master-plan.md`: module integrity/E2E tracker.
- `ir-api-sdk-operation-foundation-continuation.md`: completed/current IR
  handoff facts until C8 is complete.

### Reduce to referenced design material

- `sliding-window-cold-tier.md`: retain invariants and detailed cooling design;
  this document owns execution order and promotes its generalized durable/cold
  storage work into the deployability checklist.
- `subscription-query-ir-codegen-plan.md`: retain detailed C8 mechanics.
- `production-readiness-release-hardening-plan.md`: retain infrastructure-time
  drills and later service hardening; C4, C9, and C11 own pre-environment work.
- `regional-stdb-scaleway-durable-foundation.md`: retain only future regional
  constraints.
- relational remediation and module investigation documents: historical
  evidence/backlogs, not top-level roadmaps.

### Archive or mark superseded

- plans already declaring themselves deprecated/superseded;
- tactical PR follow-up plans whose named PR is complete;
- duplicate gateway, Qdrant, Redis, deployment, or contract-extraction plans
  when a newer canonical plan owns the decision;
- proposed agent/work-program plans from the deployability index. Keep their
  contents for the later AI program, but do not mix their checklists with the
  core release gate.

Every retained plan should receive a standard header:

```text
Status: Active | Complete | Superseded | Deferred | Reference
Canonical owner: <one plan>
Last verified against code: <date/commit>
```

No item may be counted as open in more than one canonical tracker.

## 8. Deployable-app definition of done

Environment provisioning is deliberately excluded. The application is ready to
be deployed when:

- [ ] all 458 application relations and five protocol relations have a direct
      non-null `organization_id`;
- [ ] all 458 application relations and five protocol relations are classified
      for durability, scope, retention,
      relationships, projection, cooling, hydration, and restore;
- [ ] ordered manifest-driven PostgreSQL projection is implemented;
- [ ] every enabled module has create/update/delete projection proof;
- [ ] projection migrations and release compatibility are versioned;
- [ ] semantic cooling and exact-version finalization are implemented for every
      coolable module aggregate;
- [ ] bounded hot+cold reads and hydration are proven per module;
- [ ] reconstruction of all enabled modules from PostgreSQL into empty STDB is
      proven;
- [ ] storage-aware commands, queries, and subscriptions use generated
      contracts;
- [ ] cross-tenant/company tests pass across hot, durable, and restore paths;
- [ ] lead-to-cash and procure-to-pay pass via production-built browser UI;
- [ ] retries do not duplicate business or projection effects;
- [ ] PostgreSQL loss degrades safely without cooling or silent data loss;
- [ ] STDB loss fails closed and has a tested reconstruction procedure;
- [ ] health/readiness expose dependency and durability state;
- [ ] ordinary ERP remains independent of AI and other deferred services;
- [ ] all repository Rust, frontend, codegen/drift, and selected E2E gates pass.

Until C0–C11 have persisted-data and reconstruction evidence, the app is
**Compiler-complete but semantically incomplete** for the stated
STDB-as-active-layer/PostgreSQL-as-durable-projection architecture.
