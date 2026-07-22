# DuckDB Removal and Typed Analytics Plan

## Decision

Remove DuckDB from the production AI gateway for v0.1. Replace the generic
`run_query` capability with named, typed, tenant-scoped analytics operations over
SpacetimeDB-backed data and existing API report DTOs.

This is not a migration from DuckDB SQL to unrestricted SpacetimeDB SQL. SQL and
table selection remain server-owned implementation details. The browser and
model receive typed operation names and bounded parameters only.

## Why This Change

DuckDB is currently active in the legacy AI analytics path:

```txt
SpacetimeDB table queries
-> Vec<JSON rows>
-> temporary JSON files
-> in-memory DuckDB tables
-> caller/default SQL
-> JSON result
-> model/artifact
```

The path serves `report_analysis` and `process_research`, and reports invoke
`report_analysis`. It supports joins/aggregations over curated local copies, but
for the current bounded datasets it also introduces:

- A large bundled native dependency and expensive builds.
- Duplicate data movement, temporary files, and per-run memory usage.
- Separate copies with no stronger cross-dataset consistency guarantee.
- A second SQL dialect and execution engine to operate and patch.
- A broad query surface: caller inputs can currently contain `analysis_sql`.
- A denylist validator that cannot safely represent every DuckDB table function,
  extension, filesystem, network, resource-exhaustion, or parser behavior.
- Continued dependence on the legacy orchestrator rather than the immutable
  harness release/policy path.

DuckDB can be reconsidered later as an isolated analytics worker when measured
customer workloads require local columnar analytics that named operations cannot
serve economically.

## Implementation Progress

Completed in the first migration increment:

- Removed the gateway's DuckDB dependency, sandbox modules, temporary JSON
  materialization, generic `run_query`, and default analytics SQL.
- Replaced the two active analytics skills with `analytics_summary`, a closed set
  of tenant-scoped operations for sales, stock, purchasing, and workflow state.
- Rejected legacy `sql`, `analysis_sql`, and `analysisSql` request inputs.
- Updated bundled skill definitions and seed data. Existing remote
  `report_analysis` and `process_research` records are translated at load time
  during the rollout, so they do not retain the removed tool capabilities.

Still required before v0.1 sign-off: report-DTO parity, immutable harness-route
migration, server-executed fixture promotion, hermetic E2E coverage, production
deployment validation, and the full test/performance matrix below.

## Target Architecture

```txt
browser/model intent
-> immutable released skill
-> policy + tenant/company scope
-> typed analytics operation
-> existing API report DTO or fixed server-owned SpacetimeDB query
-> bounded typed result
-> privacy guard
-> artifact/model composition
-> audit with operation + parameter/result fingerprints
```

Rules:

- No `sql`, `analysis_sql`, table name, column name, predicate fragment, URL, or
  filesystem path is accepted from browser/model input.
- Prefer existing API report endpoints when they already define accounting/report
  semantics. Do not recreate ledger calculations in the AI gateway.
- For missing small operational aggregates, use fixed server-owned query functions
  with mandatory organization/company predicates and hard row/time limits.
- Posted accounting truth remains owned by ERP reducers and report services.
- Every operation has typed input/output, required permission, allowed scope,
  maximum result size, privacy classification, and tests.

## Initial Operation Catalog

Confirm the exact catalog against the supported UI before implementation. The
minimum compatibility set is:

| Existing skill | Named operation | Source | Result contract |
| --- | --- | --- | --- |
| `report_analysis` | `sales_revenue_by_product` | Scoped sales report/query | Product ID/code/name, line count, revenue; max 20 |
| `report_analysis` | `report_summary` | Existing API report DTO | Report metadata, totals, bounded lines, cutoff |
| `report_analysis` | `inventory_movement_summary` | Fixed scoped aggregate | State, movement count, quantity; max states |
| `process_research` | `stock_movement_by_state` | Fixed scoped aggregate | State, count, quantity |
| `process_research` | `purchase_order_state_summary` | Fixed scoped aggregate | State, count, untaxed/total amount where valid |
| `process_research` | `workflow_state_summary` | Fixed organization aggregate | Workflow/state, count, oldest active age |

Input-provided `report_lines` should be accepted only through a typed bounded DTO,
validated for size and schema, then summarized in Rust without a SQL engine where
simple iteration/grouping is sufficient.

## Delivery Sequence

### Phase 0 - Characterize and Contain

Goal: freeze the surface before replacing it.

- Inventory every skill manifest, seeded skill, frontend call, test, and tool that
  references `run_query`, dataset specs, `analysis_sql`, or sandbox datasets.
- Record representative current outputs for supported report and process inputs.
- Add telemetry for legacy analytics invocations, skill key, dataset row counts,
  duration, output size, and failure category without storing sensitive rows.
- Immediately reject custom SQL for ordinary production users. If a short
  transition is necessary, place the complete DuckDB path behind
  `LUMIERE_DUCKDB_SANDBOX_ENABLED`, default false outside development.
- Add the analytics skills to the harness-managed legacy fence so new production
  use cannot bypass version/policy enforcement.

Exit gate: the complete call surface and parity fixtures are known; production
cannot accept arbitrary analytics SQL.

### Phase 1 - Define Typed Contracts

Goal: make allowed analysis explicit and reviewable.

- Add a closed Rust enum such as `AnalyticsOperation` rather than a stringly tool
  dispatcher. Each variant owns a typed parameter and output structure.
- Use newtypes/enums for organization, company, report, date range, state, money,
  and result limits where they prevent scope or unit confusion.
- Define permission, resource, privacy/masking, maximum rows, timeout, and audit
  metadata for every operation.
- Reject unknown fields and validate dates, IDs, ranges, currencies, and maximum
  input/report-line counts at the boundary.
- Document result semantics, especially accounting cutoff, currency, rounding,
  state inclusion, and whether draft/cancelled records participate.
- Bind operation names to immutable skill manifests and fixtures.

Rust requirements:

- Return `Result` with contextual application errors; do not panic or unwrap on
  request/data failures.
- Borrow inputs where ownership is unnecessary and avoid copying complete result
  sets between layers.
- Do not hold locks across `.await`; the target path should not require the
  current `Arc<Mutex<SandboxSession>>`.
- Keep APIs concrete and narrow; do not introduce a generic query-builder
  abstraction to preserve hypothetical SQL flexibility.

Exit gate: contracts and semantics receive ERP/accounting, security, and AI
harness review before data code is connected.

### Phase 2 - Implement SpacetimeDB-Backed Operations

Goal: reproduce required outcomes without an embedded query engine.

- Route report operations to existing API server report endpoints/DTOs whenever
  available. Fix the AI gateway's API server URL configuration as part of this
  work.
- Add only missing named API resources or fixed query functions. Query text,
  tables, selected columns, filters, and ordering are constants owned by the
  server; values are validated typed parameters.
- Enforce organization/company scope from authenticated server context, not from
  model-provided permissions or predicates.
- Select explicit columns instead of `SELECT *` and cap source and result rows.
- Aggregate small typed input datasets directly with Rust iterators/maps. Use
  checked money/decimal semantics required by existing accounting types.
- Add request deadlines and cancellation. Return a bounded typed error when an
  operation is too broad instead of silently truncating a financial conclusion.
- Record operation name, resolved scope, source cutoff/watermark where available,
  row counts, duration, and fingerprints in the AI run audit.

Exit gate: every catalog operation passes unit and integration tests against
representative SpacetimeDB data and existing report semantics.

### Phase 3 - Migrate Skills and Frontend

Goal: move real callers onto immutable typed execution.

- Publish new immutable versions of `report_analysis` and `process_research` that
  allow named analytics tools and exclude `run_query`.
- Remove `analysis_sql`, `sql`, and `analysisSql` from accepted inputs, skill
  documentation, seeded prompts, frontend payloads, and fixtures.
- Update reports and AI Skills UI to select an allowed analysis intent or derive
  it server-side from the report context. Do not expose an SQL editor/control.
- Run privacy transformation before model composition and persistence.
- Promote the new versions through genuine server-executed fixtures; do not use
  the current browser self-attested pass flow.
- Verify historical runs still render even though their version used the old
  engine.

Exit gate: production UI and API traffic use only released typed analytics
versions, with no call to `SandboxSession`.

### Phase 4 - Parity, Security, and Performance Gates

Goal: demonstrate that removing DuckDB improves safety without breaking the
supported outcome.

- Compare typed results with the captured legacy fixtures for totals, grouping,
  ordering, rounding, limits, and empty data.
- Add cross-organization/company tests and permission-denial tests for every
  operation.
- Test rejected SQL fields, table/column injection, excessive ranges/rows,
  malformed input lines, dependency timeout, cancellation, and provider failure.
- Ensure AI text cites the typed source artifact and cannot override the data
  result with model-generated totals.
- Benchmark representative and maximum pilot datasets. Record end-to-end latency,
  SpacetimeDB/API load, memory, payload size, and concurrency behavior.
- Run lead-to-cash, procure-to-pay, report composition, AI promotion/rollback,
  and historical audit E2E tests with DuckDB disabled.

Exit gate: typed operations meet agreed correctness and pilot performance limits,
and negative tests fail closed.

### Phase 5 - Delete DuckDB and Legacy Sandbox Code

Goal: remove the cost and prevent accidental reintroduction.

- Delete `ai-gateway/src/sandbox/` after all non-DuckDB responsibilities have
  moved to appropriately named modules.
- Remove `SandboxSession`, dataset materialization, temporary workspace files,
  generic `run_query`, default analysis SQL, and legacy dataset-spec fallbacks.
- Remove the `duckdb` dependency from `ai-gateway/Cargo.toml` and regenerate the
  lockfile through Cargo.
- Remove obsolete skill documentation, seed data, tests, feature flags, metrics,
  and operational instructions.
- Keep historical database records/version metadata; do not rewrite old audits.
- Add CI assertions that production code/manifests contain no `duckdb`,
  `analysis_sql`, or generic `run_query` capability and that `cargo tree -i
  duckdb` has no package.
- Measure release image size, clean build time/disk, startup time, and gateway
  memory before and after removal.

Exit gate: a clean checkout builds/tests without DuckDB or native DuckDB artifacts,
and the complete production v0.1 suite passes.

## Test Matrix

| Layer | Required tests |
| --- | --- |
| Contract | Unknown fields/operations, typed ID/range validation, row limits |
| Data | Tenant predicates, explicit columns, state/currency/cutoff semantics |
| ERP parity | Revenue, stock, purchase, workflow, accounting/report fixtures |
| Security | Cross-tenant, SQL input, injection, oversized data, timeout, denial audit |
| AI harness | Active release, policy snapshot, privacy, artifact fingerprint, rollback |
| Frontend | Report analysis without SQL input, errors, empty state, citations |
| E2E | Fresh tenant report/analysis, process summary, historical run rendering |
| Operations | Dependency outage, cancellation, concurrency, memory and latency bounds |

## Rollout and Rollback

During migration, deploy the typed path behind a server-owned operation flag and
compare non-sensitive result metadata in staging. Do not silently fall back from
a denied/failed typed operation to arbitrary SQL.

Rollback before final deletion means redeploying the previous immutable image and
skill release, with the DuckDB flag available only to authorized staging/dev
operators. After final deletion, rollback is an application/image rollback, not
a permanent dual-engine architecture.

## Completion Checklist

- [ ] All DuckDB callers and required outputs are inventoried.
- [ ] Production custom SQL is disabled.
- [ ] Typed operation contracts and accounting semantics are approved.
- [ ] Required report/operational operations are implemented and scoped.
- [ ] New immutable skill versions are genuinely fixture-tested and promoted.
- [ ] Frontend and API payloads contain no SQL controls or fields.
- [ ] Parity, isolation, security, E2E, and performance gates pass.
- [ ] DuckDB, sandbox materialization, temporary files, and generic query tools
      are removed.
- [ ] Clean build and runtime footprint improvements are recorded.
- [ ] Production v0.1 passes with no DuckDB dependency or fallback path.
