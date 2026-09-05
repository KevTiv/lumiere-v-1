# Code ownership and shared behavior reference

This guide maps shared business logic and wire-format behavior to their canonical owners
after the code ownership and deduplication refactor. When adding a new caller, import from
the owner listed here rather than reimplementing. When adding a new helper, check whether an
owner already exists before creating a duplicate.

See also: [refactor plan](../plan/code-ownership-deduplication-refactor-plan.md).

## Frontend shared helpers (erp-shared)

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Strict u64 ID parsing | `erp-shared/src/u64.ts` | `u64.test.ts` (18) | `parseU64`, `nullableBigIntU64`. Replaces `toScalarU64` copies and `optionalBigIntU64` rounding. |
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

## Rust shared helpers — api-server

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Integration worker lifecycle | `api-server/src/integration_worker.rs` | — | `IntegrationWorkerSpec`, `serve`, `process_batch`. 3 domain workers are thin wrappers. |
| PG identifier validation | `api-server/src/cold_tier/conventions.rs` | — | `validate_identifier`, `quote_identifier`. Rules: [a-z0-9_], 128 bytes, non-empty, release validation. |
| Canonical JSON | `api-server/src/cold_tier/conventions.rs` | golden fixtures | `canonicalize_json` (pub(crate)). Cold-tier and AI share equivalent recursive canonicalization. |
| HTTP error rendering | `api-server/src/error.rs` | 5 tests | `ApiError::Internal` redacts source message from response; logs full context. |
| Session/auth boundary | `api-server/src/web_session.rs` + `session.rs` | session tests | Bearer > cookie precedence. `require_org` returns Forbidden. Dev mock guarded by `!runtime_is_production()`. |

## Rust shared helpers — ai-gateway

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Wire decoding | `ai-gateway/src/wire_decode.rs` | — | `row_u64`, `snake_to_camel`, `canonicalize` (all pub(crate)). |
| Canonical JSON | `ai-gateway/src/wire_decode.rs::canonicalize` | golden fixtures | Shares recursive canonicalization with cold-tier. UUID-v5 (audit) vs SHA-256 (certification) preserved. |

## Rust shared helpers — spacetimedb

| Family | Owner | Tests | Notes |
| --- | --- | --- | --- |
| Accounting relations | `spacetimedb/src/accounting/relations.rs` | — | `require_active_account`, `require_active_tax_ids`, `require_analytic_account`. |
| Journal-line constructors | `spacetimedb/src/accounting/line_params.rs` | — | `build_basic_line`, `build_expense_line`, `build_subsidary_line`. Builds on canonical `AddAccountMoveLineParams`. |
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
| Canonical JSON (spacetimedb) | `spacetimedb/src/core/persistence.rs` | `api-server/src/cold_tier/conventions.rs` | Separate build universe (rule #10). Cross-universe equivalence tested via golden fixtures. |

## Intentional behavioral variants (not duplicates)

| Item | Location | Why different |
| --- | --- | --- |
| Company-only account validators | `hr/payroll.rs`, `expenses/expenses.rs` | Weaker than `require_active_account` by design. Not strengthened as a mechanical edit (D01-05). |
| `global_assignment.rs` organization lookup | `spacetimedb/src/hr/global_assignment.rs` | Checks organization only, returns company info. Cross-company assignments are intentional. |
| Workflow `replay_receipt` in approvals/delivery | `spacetimedb/src/workflow/{approvals,delivery}.rs` | Different scope-key construction and input framing (class V/I). Only runtime/migration versions were consolidated. |
| Query-specific u64 decoders | `api-server/src/query_exec.rs`, `workflow_reads.rs`, etc. | Different Result/Option envelopes, error contexts, signed-value handling. Only exact AI copies were consolidated. |

## Retired definitions (do not reintroduce)

The following were removed or consolidated. Reintroducing them is a regression:

- `toScalarU64` copies in query-hooks (replaced by `erp-shared/src/u64.ts`)
- `optionalBigIntU64` Number() rounding (fixed to use BigInt)
- `purpose_for_resource`, `fields_require_read_audit` in `spacetimedb/src/hr/pii.rs` (shadowed by `field_policy.rs`)
- `PURPOSE_HR_SELF`, `PURPOSE_HR_MANAGER`, `PURPOSE_VIEW_COMP`, `PURPOSE_VIEW_STATUTORY_ID` (dead constants)
- `ai-entity-snapshot-registry.ts` (zero TS consumers; Rust registry retained)
- `find_credential_by_identity` in `auth_password.rs` (zero callers)
- `notify_row_change` in `realtime/mod.rs` (zero callers)
- `AgingBucketKey::id()` method (never called)
- `PdfFormatQuery` struct (whole struct unused)
- `ImportAnalyzeResult`, `ImportPreviewResult` type aliases (never used)
- `merge_hot_cold_rows` in `pos_order_read.rs` (moved to `#[cfg(test)]`)
- Workflow crash/replay helpers in `workflow_worker.rs` (moved to `#[cfg(test)]`)
