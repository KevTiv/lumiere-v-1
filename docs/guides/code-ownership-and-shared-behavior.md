# Code ownership and shared behavior reference

This guide maps shared business logic and wire-format behavior to their canonical owners
during the code ownership and deduplication refactor. When adding a new caller, import from
the owner listed here rather than reimplementing. When adding a new helper, check whether an
owner already exists before creating a duplicate.

See also: [refactor plan](../plan/code-ownership-deduplication-refactor-plan.md) and
[current integration evidence](../plan/code-ownership-luna-integration-log.md).
An owner existing does not imply all consumers or runtime acceptance gates are complete.

## Frontend shared helpers (erp-shared)

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Strict u64 ID parsing | `erp-shared/src/u64.ts` | `u64.test.ts` | `parseStrictU64`, `scalarToU64`; form wrappers delegate to this owner. Invalid values never pass through `Number` first. Object/Option recursion is bounded. |
| Timestamp adapters | `erp-shared/src/timestamp-values.ts` | `timestamp-values.test.ts` (18) | Named adapters per unit (micros, millis, ISO, SDK). `compatNumberToDate` preserves 10B threshold. |
| Row field access | `erp-shared/src/row-values.ts` | `row-values.test.ts` (13) | `firstOwnedKey`, `firstNonNullKey`, `getRowField`. Preserves null vs absent. |
| Contact matching | `erp-shared/src/contact-matching.ts` | `contact-matching.test.ts` (7) | Name/email/phone normalization. Phone blank falls back to mobile. |
| CSV import safety | `erp-shared/src/csv-import-safety.ts` | existing tests | Formula injection, size limits. |
| CSV import transform | `erp-shared/src/csv-import-transform.ts` | existing tests | Header normalization, row mapping. |
| Navigation catalog | `ui/src/lib/navigation-catalog.ts` | — | Shared by sidebar and command palette. Presentations stay separate. |

## Frontend AI HTTP helpers (web)

| Family | Owner | Notes |
| --- | --- | --- |
| AI form request | `web/app/api/ai/_lib/form-request.ts` | `sanitizeFields`, `aliasString`. Used by forms/suggest, forms/validate. |
| AI RAG request | `web/app/api/ai/_lib/rag-request.ts` | `sanitizeIncludeTypes`, `prepareRagPayload`. Used by rag/route, rag/stream. |
| AI route helpers | `web/app/api/ai/_lib/route-helpers.ts` | Session/org resolution, JSON validation, gateway proxy. 24+ routes. |
| Settings audit formatting | `ui/src/lib/audit-log-utils.ts` | `auditTimestampToIso`, `formatAuditEntryDetails`. Settings tab uses shared owner. |
| Positive HTTP IDs | `web/app/api/ai/_lib/positive-integer.ts` | Decimal scalar IDs only; rejects fractions, junk, grouping and unsafe numbers. Narrower input contract than form parsing. |
| Entity display values | `ui/src/lib/entity-row-values.ts` | Pure, tested compatibility adapters: PascalCase aliases, exact-null precedence, millisecond numbers and integer microsecond division. Component-facing helpers retain re-exports. |

## Rust shared helpers — api-server

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Integration worker lifecycle | `api-server/src/integration_worker.rs` | — | `IntegrationWorkerSpec`, `serve`, `process_batch`. 3 domain workers are thin wrappers. |
| PG identifier validation | `api-server/src/cold_tier/conventions.rs` | — | `validate_identifier`, `quote_identifier`. Rules: [a-z0-9_], 128 bytes, non-empty, release validation. |
| Canonical JSON | `api-server/src/cold_tier/conventions.rs` | golden fixtures | `canonicalize_json` (pub(crate)). Cold-tier and AI share equivalent recursive canonicalization. |
| HTTP errors | `api-server/src/error.rs` | status/body and source-chain tests | `ApiError::internal` / `From<anyhow::Error>` preserve typed failures; HTTP and Display remain redacted. `Internal(String)` is retained for already-string upstream failures and non-Error crypto errors. Never include credentials in added error context. |
| Session/auth boundary | `api-server/src/web_session.rs` + `session.rs` | session tests | Bearer > cookie precedence. `require_org` returns Forbidden. Dev mock guarded by `!runtime_is_production()`. |

## Rust shared helpers — ai-gateway

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Wire decoding | `ai-gateway/src/wire_decode.rs` | unsigned bounds, alias/null precedence, golden bytes | `row_u64`, `snake_to_camel`, `canonicalize` (all pub(crate)). |
| Canonical JSON | `ai-gateway/src/wire_decode.rs::canonicalize` | golden fixtures | Shares recursive canonicalization with cold-tier. UUID-v5 (audit) vs SHA-256 (certification) preserved. |

## Rust shared helpers — spacetimedb

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Accounting relations | `spacetimedb/src/accounting/relations.rs` | — | `require_active_account`, `require_active_tax_ids`, `require_analytic_account`. |
| Journal-line constructors | `spacetimedb/src/accounting/line_params.rs` | domain validation pending | `journal_line_params` and `blank_journal_line`. Builds on canonical `AddAccountMoveLineParams`; company-only validation remains explicitly distinct. |
| FX metadata merge | `spacetimedb/src/accounting/fx_metadata.rs` | — | `merge_exchange_rate_metadata`. Pure narrow function. |
| HR relations | `spacetimedb/src/hr/relations.rs` | — | `require_employee_in_scope`. |
| Subscription relations | `spacetimedb/src/subscriptions/relations.rs` | — | `require_subscription`. |
| Workflow receipts | `spacetimedb/src/workflow/receipts.rs` | — | `replay_command_receipt`. Narrow visibility. |

## Intentional cross-boundary duplicates

These duplicates are documented and retained because sharing a crate or module would violate
build-universe boundaries (architecture rule #10) or because the variants have intentionally
different behavior.

| Item | Copy 1 | Copy 2 | Reason retained |
| --- | --- | --- | --- |
| HR PII constants (`HR_EMPLOYEE_SENSITIVE`, `HR_EMPLOYEE_PIN`, `HR_CONTRACT_COMP`, `HR_PAYSLIP_COMP`) | `crates/stdb-auth/src/field_policy.rs` (private, `apply_hr_field_policy`) | `spacetimedb/src/hr/pii.rs` (pub, `log_hr_pii_read` reducer) | Separate build universes (root service crates vs standalone spacetimedb/). Both copies have live consumers. |
| CSV row splitter (`split_csv_row` / `splitCsvRow`) | `spacetimedb/src/data_ops/helpers.rs` | `ai-gateway/src/skills/import.rs` + frontend CSV family | Three runtimes (Rust reducer, Rust AI gateway, TypeScript). Cross-language sharing not practical for 27 lines. |
| `snake_to_camel` case converters | `api-server/src/cold_tier/pg_codec.rs` | `ai-gateway/src/wire_decode.rs` | Separate crates, same algorithm. Cross-crate sharing not justified. |
| Codegen `camel_to_snake` variants | `lumiere-codegen/src/sql_columns_emit.rs` | `lumiere-codegen/src/stdb_bindings_parse.rs` | Intentionally different: one handles M2O/M2M/O2M relation suffixes, the other is a simple type-name converter. |
| Canonical JSON (spacetimedb) | `spacetimedb/src/core/persistence.rs` | `api-server/src/cold_tier/conventions.rs` | Separate build universe (rule #10). API and AI bytes/final hashes are pinned by golden tests; complete reducer-side parity remains a separate gate. |

## Intentional behavioral variants (not duplicates)

| Item | Location | Why different |
| --- | --- | --- |
| Company-only account validators | `hr/payroll.rs`, `expenses/expenses.rs` | Weaker than `require_active_account` by design. Not strengthened as a mechanical edit (D01-05). |
| `global_assignment.rs` organization lookup | `spacetimedb/src/hr/global_assignment.rs` | Checks organization only, returns company info. Cross-company assignments are intentional. |
| Workflow `replay_receipt` in approvals/delivery | `spacetimedb/src/workflow/{approvals,delivery}.rs` | Different scope-key construction and input framing (class V/I). Only runtime/migration versions were consolidated. |
| Query-specific u64 decoders | `api-server/src/query_exec/row_values.rs`, `workflow_reads.rs`, etc. | Different Result/Option envelopes and source contracts. Malformed scope must not become shared scope; negative integers must not wrap to u64. |

## Retired definitions (do not reintroduce)

The following were removed or consolidated. Reintroducing them is a regression:

- `toScalarU64` copies in query-hooks (replaced by `erp-shared/src/u64.ts`)
- `optionalBigIntU64` Number() rounding (fixed to use BigInt)
- `purpose_for_resource`, `fields_require_read_audit` in `spacetimedb/src/hr/pii.rs` (shadowed by `field_policy.rs`)
- `PURPOSE_HR_SELF`, `PURPOSE_HR_MANAGER`, `PURPOSE_VIEW_COMP`, `PURPOSE_VIEW_STATUTORY_ID` (dead constants)
- `ai-entity-snapshot-registry.ts` (zero TS consumers; Rust registry retained)
- `find_credential_by_identity` in `auth_password.rs` (zero callers)
- `AgingBucketKey::id()` method (never called)
- `PdfFormatQuery` struct (whole struct unused)
- `ImportAnalyzeResult`, `ImportPreviewResult` type aliases (never used)
- `merge_hot_cold_rows` in `pos_order_read.rs` (moved to `#[cfg(test)]`)
- Workflow crash/replay helpers in `workflow_worker/tests.rs` (test-only, retained)

## Feature-module boundaries

- Accounting hook callers keep `@lumiere/query-hooks/hooks/accounting`; feature
  files own hooks and invalidation helpers, and `accounting/index.ts` preserves
  the original export surface.
- HTTP process lifecycle lives in `http_app/mod.rs`; router composition and CORS
  are separate. Query/operation/health adapters live under `routes/`, and both
  command endpoints share `commands.rs` validation/execution.
- Auth children own cookies, password flows, recovery, profile, service bridge,
  and invitations. Credential and membership sequencing is unchanged.
- CRM routes separate leads, contacts, contact identities and roles. Document
  routes load data and build HTTP responses; `document_render` owns pure
  financial formatting, CSV, XLSX and printpdf output. Report previews use the
  separate typed `reports/service` and `reports/render` domain owners, including
  the existing Chromium transport. Do not conflate the two PDF transports.
- `platform_control` separates schema, credentials, profiles, password resets
  and service identities behind explicit re-exports. Each original transaction
  remains with one owner; these global rows are not organization projections.
- Query special cases delegate to accounting, purchasing, inventory, AI, forms,
  imports, access-control, documents and worklists. The public dispatcher keeps
  literal keys and handled-empty precedence. `hr` owns employee reads and PII
  auditing; `registered` builds registry-backed SQL; `crm` owns post-filtering.
  Authorization and post-fetch dispatch orchestration remain explicit in `mod.rs`.
- Cold reads share one `ResourceReadPlan`, metadata validator and SQL compiler;
  `cold_tier/mod.rs` re-exports the existing API. Do not fork authorization rules
  into separate hot and cold compilers.
- `commit_projection/apply.rs` owns the complete transaction. Its helpers cannot
  independently open or commit transactions; original PostgreSQL tests remain.
- Reconstruction owns its fence sequence in `reconstruction/coordinator.rs`;
  PostgreSQL pagination stays in `postgres_source.rs`, while pure validation
  stays in `integrity.rs`. Projection polling separates `drain_batch` from
  `drain_organization`; per-organization failures must not stop batch fairness.
- Workflow delivery keeps timers, outbox completion order and adapter behavior in
  separate modules; crash/replay simulation remains test-only.
- Workflow reads separate candidate/company scope, human-task projections,
  definition redaction and operational projections. The facade owns dispatch.
- Realtime separates subscription validation/planning, SDK bridge and socket
  orchestration. This extraction preserves the existing detached SDK thread;
  it does not claim to implement new cancellation or connection cleanup.
- `web_session::OrgSession` resolves the existing session and requires its org.
  Selected GET handlers adopt it after path parsing. It must not select an
  owner token or default company. Body-bearing routes require a separate
  rejection-order review before migration.

## Durable availability and required tests

Audit-history and POS hot/cold page reads return a redacted HTTP 503 if the cold
store is unavailable; a hot-only subset must not look like a complete result.
Readiness probes PostgreSQL with a three-second bound, including pool acquisition
and `SELECT 1`. Liveness remains independent. Pool initialization failure is
cached until restart; a successfully configured pool can reconnect after outages.

Focused CI Cargo gates use `scripts/run-required-cargo-tests.py`, which lists
tests first and rejects zero matches before running them. The reducer gate now
targets `commands::tests`. Database tests still require `C3_TEST_PG=1` and a real
database: test discovery alone does not establish database coverage.

`realtime::notify_row_change` is **live generated-code support**, not retired
code. Generated callbacks emit only table/resource invalidations through it,
never row payloads. Validate that seam against populated pinned bindings, not
an empty staging directory that generates no callbacks.
