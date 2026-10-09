# Claude UI PR — item 1 read-path hardening

Date: 2026-10-09
Delivery branch: `codex/ui-read-hardening`
Stack base: `claude/pass23-ui` / PR #160, `ab87943a772d955c947170d04858eaddc5716a1b`
Implementation/test baseline: `claude/pass14-ui`, `47b640e8db0c245a32768f7d4a8751e29a3f09e4`
Release gate: **REVIEW — implementation and focused tests, not live acceptance**

## Scope

This slice addresses server-side read grants, company/owner/parent scope, and the response projections consumed by the Pass 12 screens. It does not implement reconciliation, CSV imports, document mutation repairs, or a whole-module relational audit.

The twelve protected query feeds are:

- Accounting: `profit-loss-lines`, `balance-sheet-lines`, `cash-flow-lines`, `bank-statement-import-lines`, `tax-deadline-reminders`, `consolidation-company-rates`.
- HR: `hr-leave-allocations`, `hr-offboarding-checklists`, `hr-statutory-ids`.
- Documents: `document-signature-requests`, `document-legal-holds`, `document-external-refs`.

Additional projection corrections cover `product-attribute-lines.value_ids` and the required `document-versions.document_id` relation.

## Source trace and implemented controls

| Boundary | Source | Control |
| --- | --- | --- |
| Query dispatch | [`query_exec/mod.rs`](../../api-server/src/query_exec/mod.rs) — `require_ui_child_read_permission`, `execute_resource_query_for_company` | Match authenticated identity and organization; require canonical resource/domain read grants before SQL. Write-only grants do not satisfy this gate. |
| Accounting company authority | [`company_scope.rs`](../../api-server/src/query_exec/company_scope.rs) — `accounting_resource`, `accounting_child_resource`, `accounting_read_permission_resource` | Direct-company classification is limited to schema-backed columns. Reuse membership/default-company resolution and reject conflicting browser company intent. |
| Accounting relations | [`accounting.rs`](../../api-server/src/query_exec/accounting.rs) — `read_accounting_child_rows` | `bank_statement_import_line.import_id → bank_statement_import.id`; `tax_deadline_reminder.tax_deadline_id → tax_deadline.id`. Validate parent organization/company, exclude missing/deleted/unassigned tax parents, decode optional relations in Rust. |
| HR relations | [`hr.rs`](../../api-server/src/query_exec/hr.rs) — `read_hr_child_rows` | Validate child organization/company plus actual `employee_id → hr_employee.id` parent scope. Preserve employee all/self rules; bound employee lookup predicates. |
| Statutory disclosure | [`field_policy.rs`](../../crates/stdb-auth/src/field_policy.rs), [`hr.rs`](../../api-server/src/query_exec/hr.rs) | `value` requires `hr_employee:view_statutory_id` as well as a read grant. Sensitive permission does not widen an explicit field selection. Successful audit is required before returning nonempty sensitive rows. Audit contains field names/count/scope, not raw statutory values. |
| Statutory audit namespace | [`pii.rs`](../../spacetimedb/src/hr/pii.rs) — `pii_read_audit_table`, `log_hr_pii_read` | General audit uses `hr_statutory_id` with the statutory row ID instead of misclassifying that ID as `hr_employee`. Existing mappings/fallback are preserved; no schema or reducer signature change. |
| Document relations | [`documents.rs`](../../api-server/src/query_exec/documents.rs) — `read_document_child_rows` | Child `document_id → document.id` inherits the existing live-document organization/owner/`is_deleted` ACL, including for superusers. Child queries use bounded authorized-parent predicates, never an organization-wide child fallback. |
| HTTP projections | [`resource_registry.json`](../../crates/stdb-auth/assets/resource_registry.json), [`field_policy.rs`](../../crates/stdb-auth/src/field_policy.rs) | Restore statement `report_id`, hierarchy/currency fields, product attribute values, child scope/parent identifiers, and missing mapper fields. Internal validation columns are stripped where not part of the browser projection. No new query resource is introduced. |
| Realtime routing | [`erp_subscriptions.rs`](../../crates/stdb-auth/src/erp_subscriptions.rs), [`erp-subscriptions.ts`](../../frontend/packages/stdb/src/queries/erp-subscriptions.ts) | All twelve feeds fail closed in the subscription builders, including superuser contexts; use authorized HTTP instead. This is not proof of general direct-table access restrictions. |
| HR browser scope/cache | [`hr/reads.ts`](../../frontend/packages/query-hooks/src/hooks/hr/reads.ts), [`hr/reads-options.ts`](../../frontend/packages/query-hooks/src/hooks/hr/reads-options.ts) | Require ready active company; send `companyId`; separate company cache keys; prevent not-ready/manual-refetch access to prior company rows. Preserve denied/unavailable/empty state distinctions. |

## Validation

The results below were collected on the implementation baseline with installed contracts v0.3.86. The delivery branch carries the same read-hardening changes onto the UI stack tip; the affected source files are unchanged between those bases. The stack independently pins contracts v0.3.87, so these results are not a claim of complete same-head validation against that pin. Run from the repository root unless stated otherwise. Suite counts overlap; they are not a count of unique tests.

| Check | Result |
| --- | --- |
| `docker exec -w /workspace lumiere-dev-api-server-1 cargo test -p api-server --lib query_exec --offline --locked` | **78 passed**. Includes actual dispatcher plus mock HTTP/SATS decoding, authorization denial before SQL, forged company rejection, hostile parent/child scope, document ACL, and statutory audit failure. This is not a deployed-database test. |
| Same Docker command, `cargo test -p stdb-auth --lib pass12 --offline --locked` | **6 passed**. Projection/scope fields, explicit field selection, product values, HTTP-only feeds. |
| Same Docker command, `cargo test -p stdb-auth --lib statutory --offline --locked` | **2 passed**. Sensitive selection and audit classification. |
| Same Docker command, `cargo test -p stdb-auth --lib erp_subscriptions --offline --locked` | **9 passed**. |
| From `frontend/packages/query-hooks`: `node --import tsx --test src/hooks/hr/reads.test.ts src/hooks/hr-allocations.test.ts src/hooks/read-ui-rows.test.ts` | **41 passed**. |
| `docker exec -w /workspace/frontend/packages/stdb lumiere-dev-web-1 pnpm exec node --import tsx --test src/queries/erp-subscriptions.test.ts` | **24 passed**. |
| Audit-mapping helper and its two tests extracted unchanged from `spacetimedb/src/hr/pii.rs` and run with `rustc --edition 2021 --test` | **2 passed**, isolated pure-function regression only. Not a full reducer/module build or persisted audit proof. |
| Targeted `rustfmt --edition 2021 --check` on changed Rust files; `git diff --check` | **Passed**. |

### Stack-tip recheck

After moving the changes to `codex/ui-read-hardening` on #160, the 41 hook/mapper tests, targeted Rust formatting, and `git diff --check` passed again. The API query-suite rerun against the stack tip waited on the Cargo artifact lock, began recompiling `api-server`, then exceeded the 120-second limit before a test result. The earlier 78-test pass is baseline evidence, not a passing stack-tip rerun.

### Checks that did not pass / remain incomplete

- **Full standalone module tests:** Docker offline test could not resolve the uncached `spacetimedb` server SDK. Host `cargo test --manifest-path spacetimedb/Cargo.toml --lib hr::pii::tests --offline --locked` began compiling from the available host cache but exceeded the 180-second limit before tests executed. No full-module test success is claimed.
- **Query-hooks typecheck:** initial Docker run exhausted the default heap. One retry with `NODE_OPTIONS=--max-old-space-size=4096` completed and reported exactly one error: `src/hooks/documents.ts(466,52): TS2345`, `release_document_legal_hold` is not assignable to installed `StdbBffNamedReducerKey`. That hook is unchanged by this slice. No diagnostics were reported for the changed HR read files. This baseline typecheck was not green. PR #154 already exposes this reducer and pins contracts v0.3.87; confirm the fix using the matching installed contracts rather than treating the v0.3.86 cache result as a remaining stack-source defect.
- **Broader field-policy suite:** earlier run had 34 passes and one unrelated failure, `resolve_http_sql_columns_exposes_helpdesk_lifecycle_without_customer_pii` (default helpdesk projection includes `user_id`). Helpdesk source was not changed.
- **Codegen/release:** a read-only schema snapshot from local `lumiere-cov05d-docker-20261008` allowed `lumiere-codegen` to pass the dispatcher audit after integrating new arms into the existing dispatcher match. Generation then stopped at `reducer exposure names reducer absent from module schema: mark_all_notifications_read`. The running module predates this branch. This is not successful contract regeneration.

## Remaining acceptance / release gates

1. Obtain a matching branch module/schema in a dedicated authorized test environment; do not clear or replace the existing local database as a shortcut. Complete normal contract generation and immutable release/pinning. No generated bindings or dependency pins were hand-edited here.
2. Finish the full standalone module test/build and same-head typecheck with the stack's matching contract pin. Confirm the upstream document legal-hold exposure fixes the cached-contract error; do not change this mutation merely to silence an obsolete dependency-cache diagnostic.
3. Seed distinctive parent/child records in organizations A/B and companies A1/A2, including missing/deleted/unassigned parents, another document owner, and an actor without read grants. Exercise all twelve HTTP feeds with real memberships and verify returned IDs/projections, denial, and no cross-scope disclosure. Verify the real server accepts the generated SQL/Option encodings.
4. With statutory read plus sensitive permissions, inspect persisted `hr_pii_access_log` and general `audit_log` rows: exact actor/org/company, purpose/resource, `hr_statutory_id` namespace, statutory row ID for a single-row read, field names/count, and no raw value. Verify a failed audit does not produce a successful sensitive response. Mock reducer calls are not persisted evidence.
5. Exercise the actual screens after fresh reload and a company switch. Verify statement hierarchy/report selection, attribute values, child-parent association, masked/denied/unavailable/empty HR states, no previous-company cache reuse, and no realtime fallback for the twelve feeds. Attach browser and persisted-data evidence before closing item 1.

## Worktree / rollout notes

- Delivery is a focused draft PR after #160, rather than rewriting the existing #154–#160 stack. No contract publication or database deployment was performed.
- Existing `frontend/web/next-env.d.ts` and the two untracked `scripts/__pycache__/*.cpython-314.pyc` files were preserved.
- No business mutation signature/schema migration was introduced. Registry producer-input changes still require the normal contract release workflow.
- HTTP-only routing intentionally trades realtime updates for the required authorization/audit path. Caller permissions, membership scope, and existing document ACL remain authority; client filters are not authority.

The slice has focused source/mock evidence but lacks matching generated-contract release, deployed SQL, persisted audit, and refreshed operator-path evidence. It is not production-complete.

**Partially relational**
