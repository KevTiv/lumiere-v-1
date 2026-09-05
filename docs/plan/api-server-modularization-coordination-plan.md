# API-server modularization: coordinated implementation plan

Status: Ready for implementation; no refactor work has been completed by this document.
Created: 2026-09-04.
Scope: `api-server/src`, its focused tests, and source-inspecting codegen tooling affected by file moves.
Execution owner: The primary agent session implementing this plan (the coordinator).
Location: `docs/plan` as requested; related architectural plans remain in `docs/plans`.

Companion work: [build DX and CI execution ledger](build-dx-ci-execution-plan.md).
Build-orchestration improvements do not complete any module extraction below.

Expanded refactor handoff: [code ownership and deduplication plan](code-ownership-deduplication-refactor-plan.md).
Its D40 task coordinates the M-tasks in this document rather than executing a
second extraction plan. Agree the order of overlapping helper corrections and
file moves before assigning agents; keep behavior changes separate from moves.

## 1. Objective and authority

Break large, mixed-responsibility modules into cohesive modules while preserving HTTP behavior, public Rust entry points, authorization, generated-contract ownership, and persistence semantics. The coordinator must delegate bounded work, review every returned change, integrate it into the working codebase, and verify the combined result. Delegation alone does not complete a task.

This document authorizes the implementation session to use subagents for the refactor when the user asks it to execute this plan. Writing this document does not start implementation. It does not authorize production operations, contract publication, remote pushes, or PR merges.

The architecture and release requirements in `../plans/core-vertical-deployability-pruning-plan.md` still apply. This is a structural refactor, not evidence that its C0–C11 correctness or release gates have been completed.

Success means a domain change has an identifiable owner, a reviewer can follow security and transaction decisions locally, and the replacement files do not become new catch-all modules. Line count is a review signal, not a completion metric.

## 2. Findings and starting assumptions

The inspection that informed this plan found the following candidates. Counts are historical orientation; recheck the checkout before assigning work.

| Existing file, relative to `api-server/src` | Lines | Primary split boundary |
| --- | ---: | --- |
| `query_exec.rs` | 2,850 | Dispatch, shared scope resolution, domain-specific reads |
| `cold_tier/commit_projection.rs` | 1,627 | Atomic application, preparation, SQL, checksums, tests |
| `cold_tier/reconstruction.rs` | 1,574 | Catalog, protocol, coordinator, source, sink, integrity, tests |
| `routes/auth.rs` | 1,136 | Password, recovery, profile, service bridge, invitations |
| `cold_tier/projection_worker.rs` | 1,056 | Polling, decoding, per-organization draining, status, relations |
| `cold_tier/mod.rs` | 970 | Read contract, descriptors, validation, compiler, bindings, merge |
| `workflow_worker.rs` | 940 | Lifecycle, timers, leased outbox delivery, external adapter |
| `http_app.rs` | 920 | Startup, router composition, HTTP handlers, command validation |
| `reports/render.rs` | 875 | Chromium transport, shared HTML, report-specific rendering |
| `reports/service.rs` | 872 | Preview dispatch, grouped report loading, history, query primitives |
| `workflow_reads.rs` | 821 | Dispatch, candidate authorization, human tasks, definitions, operations |
| `routes/crm.rs` | 767 | Leads, contacts, contact identities, contact roles |
| `platform_control.rs` | 728 | Credentials, profiles, resets, service identities, schema |
| `routes/documents.rs` | 622 | HTTP handlers, source loading, financial exports, PDF generation |
| `realtime/mod.rs` | 573 | Subscription authorization/planning, SDK bridge, socket lifecycle |

Do not infer production complexity from total size alone. Projection/reconstruction files contain substantial tests. `organization_placement.rs` is deferred: its 875 lines include approximately 313 lines of tests, and its production state machine is comparatively cohesive.

Corrections that must survive implementation:

- Workflow crash/replay helpers are used by five tests; move them under test configuration, do not delete them as abandoned code.
- `pos_order_read::merge_hot_cold_rows` is a test helper; its production equivalent is already called directly.
- Unused worker row `organization_id` fields do not establish missing tenant scope. Outer organization IDs already scope queries and reducer calls. Any removal or new validation is a distinct cleanup.
- The canonical resource registry already exists in `crates/stdb-auth`. Do not create another handwritten source of truth.
- Current `query_exec_audit` uses a textual first-match search that can select `authoritative_resource_scope` instead of the intended dispatcher. Repair and prove audit coverage before relying on it during extraction.
- An earlier `cargo check -p api-server` passed with 19 warnings. The full test suite was not verified in that review. Establish a current baseline; do not copy the earlier result into completion evidence.

## 3. Refactoring rules

1. Preserve URLs, HTTP methods, status/body shapes, cookie behavior, bearer/cookie precedence, query resource names, operation names, and reducer argument contracts.
2. Keep organization identity server/session-derived. Preserve client company validation and each existing default-company behavior; similarly shaped resolvers may have different semantics.
3. Keep a resource's permission checks, SQL restrictions, parent visibility, result filtering, field removal, and auditing together or explicitly connected through its owner. No generic security `filters.rs` collection.
4. Preserve workflow dispatch precedence. A recognized query returning no rows is still handled; it must never fall through to a broader query.
5. Preserve SpacetimeDB SQL workarounds, Option/enum decoding, large integer handling, sorting, pagination, and soft-delete behavior.
6. Preserve one projection transaction owner and one reconstruction fence-lifecycle owner. Helpers must not independently commit or release fences.
7. Preserve manifest provenance and exact canonicalization/checksum behavior. Do not consolidate similar checksum algorithms as part of moving files.
8. Preserve existing public Rust paths through explicit re-exports. Use private or `pub(super)` helpers; widen to `pub(crate)` only for an actual crate-level consumer.
9. Keep request types beside handlers and test fixtures beneath their test owner. Introduce shared modules only for real shared behavior.
10. Do not add dependencies, crates, generic repository layers, dispatcher plugin systems, or a handwritten global resource enum solely to accomplish extraction.
11. Separate mechanical moves from deduplication and behavioral corrections. If a current bug is found, record it and propose a focused fix; do not silently encode it as a desired regression-test expectation.
12. No temporary empty handlers, disabled audits, broadened fallbacks, or blanket warning suppression to make an intermediate state green.

## 4. Coordinator and subagent operating contract

### Coordinator responsibilities

The coordinator owns execution through integration, not just assignment:

- Inspect the current branch, worktree changes, applicable instructions, current plan status, and ongoing work before editing.
- Inventory callers, generated/source-inspecting tooling, and test boundaries for each batch.
- Agree the file ownership and exported signatures before dispatching agents.
- Assign at most the available subagent capacity. With four total slots, use up to three implementation agents and retain the primary slot for coordination/review.
- Keep a file-ownership ledger and a single Cargo/codegen validation slot. Never start competing Cargo jobs against the same target directory.
- Review actual diffs and relevant surrounding code, not just subagent summaries.
- Integrate module declarations, imports, re-exports, router composition, and shared tooling changes.
- Run the integrated validation matrix, resolve regressions caused by the batch, and document unrelated baseline failures separately.
- Update the task ledger after every accepted batch. Stop assigning dependent work when its prerequisite is not accepted.
- Finish with the code integrated and evidence recorded, or a precise list of remaining tasks and blockers. Never report completion while required verification or integration remains outstanding.

### Shared checkout and reserved files

Use the existing checkout with disjoint ownership by default. Subagents see each other's edits immediately; do not describe their output as isolated patches unless they actually use separate worktrees.

Reserve these files for the coordinator unless explicitly transferred for a bounded interval:

- This plan and any execution ledger linked from it.
- `api-server/src/lib.rs`, `routes/mod.rs`, `cold_tier/mod.rs`.
- Root files being converted into directories: one conversion owner at a time.
- Shared router wiring, public re-exports, and call sites outside a subagent's assigned files.
- `api-server/build.rs`, Cargo manifests/lockfile, Makefile, CI workflows, codegen path/audit wiring, canonical registries and generated artifacts.

Before creating `name/mod.rs`, the coordinator must plan removal of `name.rs`; Rust cannot resolve both as the same module. Use an atomic module-conversion step with validation paused until the wiring is coherent. Preserve existing import paths rather than editing every consumer gratuitously.

One agent may own an entire directory conversion, including its original file, if it has no competing owner. Multiple agents may work on distinct children only after the coordinator has established the module skeleton and transferred exact source blocks. No two agents extract from the same original god file concurrently.

Agents must not run broad formatters, modify shared declarations, rewrite manifests, commit other agents' work, or resolve conflicts by overwriting files. Local conflicts return to the coordinator. Subagents do not push or merge.

### Assignment template

```text
Task ID and objective:
Base revision and accepted prerequisites:
Allowed original files and destination files:
Reserved files / other active owners:
Source functions, types, tests to move:
Required public signatures and re-exports:
Behavior and ownership invariants:
Permitted local validation; Cargo slot owner:
Required handoff:
  - changed files and exact exports/imports needed;
  - old-to-new responsibility mapping;
  - behavioral changes (must be none unless separately approved);
  - tests moved, added, run, skipped, and why;
  - risks, discoveries, unresolved integration work.
Do not extend scope or start another task without coordinator assignment.
```

Use the session's configured model by default. This plan does not require a particular model or authorize background user-owned tasks. Use subagents within the implementation session.

### Acceptance and integration loop

For each returned assignment:

1. Compare the diff to its assignment; reject opportunistic redesign and unrelated edits.
2. Verify all original entry points, branches, tests, comments explaining workarounds, and manifest inputs have destinations. Inspect moved code with move-aware diffs where useful.
3. Review error propagation, early-return placement, credential/client selection, tenant/company checks, ordering, transaction scope, and shutdown behavior.
4. Integrate the exact exports and call sites; use explicit imports in production modules rather than broad `use super::*` to hide dependencies.
5. Run focused checks on the combined tree. A subagent's isolated passing result does not replace this step.
6. Address issues directly or return a bounded correction request. Mark accepted only after the integrated result meets the task gate.
7. Record revision or patch identity, changed paths, reviewer, commands/results, and any remaining prerequisite for release.

The coordinator is the final reviewer. An independent review subagent may assist after implementation ownership is released, but does not replace coordinator review.

## 5. Destination module map

Paths below are relative to `api-server/src`. These are responsibility targets, not a requirement to create empty files. The coordinator may combine very small cohesive groups, documenting why. A substantially different boundary requires revisiting affected assignments before work proceeds.

### A. Query execution

```text
query_exec/
  mod.rs                 public entry points and explicit resource dispatch
  authoritative.rs       authorized single-record reads
  company_scope.rs       company discovery and membership-based resolution
  row_values.rs          shared JSON identity, numeric and Option decoding
  registered.rs          default registry-backed reads and shared execution mechanics
  crm.rs                 CRM classification and company/parent visibility
  accounting.rs          accounting, assets, consolidation, periods
  purchasing.rs          purchase approvals, partner banks, landed-cost lines
  inventory.rs           inventory, picking, shipping and POS queries
  hr.rs                  employee visibility, manager lookup, PII read auditing
  ai.rs                  AI queries and permission rules
  documents.rs           document ownership and template queries
  access_control.rs      roles, field/org permissions and policy snapshots
  imports.rs             import jobs, errors and mapping templates
  forms.rs               form configuration queries
  worklists.rs           existing shared status-filtered approval/time views
```

Retain one explicit dispatch owner and the existing canonical registry. `registered.rs` must not grow a second special-case dispatcher. Domain-specific post-processing belongs with its domain, even when invoked after a shared registry read. Preserve existing workflow delegation and direct cold-tier delegation.

Move supporting functions and authoritative reads first, then one domain at a time. Keep existing company resolver distinctions initially. A borrowed execution context is optional only if it removes actual repeated arguments without hiding authority or changing client selection. Do not introduce a large struct of optional company IDs as a substitute for domain ownership.

### B. HTTP assembly and commands

```text
http_app/
  mod.rs                 serve, environment/tracing initialization, listener
  router.rs              route composition and middleware ordering
  cors.rs                existing CORS configuration
routes/queries.rs         query and authoritative HTTP adapters
routes/operations.rs      named-operation and positional compatibility adapters
routes/health.rs          health, readiness and metrics handlers
commands.rs               exposure, argument/scope validation and reducer execution
```

Both operation endpoints use the same underlying command validation/execution path. Preserve their distinct input formats. The optional auth extractor is a later task in `web_session.rs`, delegates to current resolution, and must not choose privileged clients or default companies. Keep its integration coordinated with callers; do not simultaneously extract handlers and alter their authentication behavior.

### C. Authentication

```text
routes/auth/
  mod.rs                 existing URL wiring
  cookies.rs             session cookie creation/removal
  password.rs            sign-in, sign-up, sign-out
  recovery.rs            forgot-password and reset-password
  profile.rs             profile reads and updates
  service_bridge.rs      WorkOS/internal bootstrap and service-token validation
  invitations.rs         invite creation and acceptance
```

Request structs travel with handlers. Preserve PostgreSQL credential/profile ownership and the order of membership creation and organization-owned materialization. Continue using `auth_password` and `platform_control`; subdivide the latter only in its assigned later task.

### D. Reports

```text
reports/service/
  mod.rs                 preview entry point, ReportPreview and dispatch
  source_queries.rs      shared typed query, company/window and bounds primitives
  history.rs             history and artifact lookup
  commercial.rs          commercial report source loading
  inventory.rs           low stock and stock movement source loading
  financial.rs           cash and open balance source loading
  daily_summary.rs       daily business summary source loading
reports/render/
  mod.rs                 render entry point and typed report dispatch
  chromium.rs            renderer transport and response checks
  html.rs                escaping, shell, tables, money/text formatting
  commercial.rs          commercial report HTML
  inventory.rs           inventory report HTML
  financial.rs           cash and open balance HTML
  daily_summary.rs       daily summary HTML
```

Preserve existing pure aggregators in `reports/commercial.rs`, `open_balances.rs`, etc. Service modules load data and call aggregators; renderers consume typed results. `source_queries.rs` must not become a warehouse of every report's SQL. Preserve query bounds, currency rules, watermarks, report catalog keys and HTML escaping. Do not change generated artifact/hash behavior during extraction.

### E. Cold read foundation

Keep existing children of `cold_tier/`; reduce `mod.rs` to declarations and explicit API re-exports. Add:

```text
cold_tier/read_plan.rs          ResourceReadPlan and structural predicate/order/page types
cold_tier/archive_descriptor.rs generated archive metadata resolution
cold_tier/read_validation.rs    read-plan, projection, scope and predicate validation
cold_tier/read_sql.rs           shared SQL compiler and backend-specific syntax
cold_tier/pg_bind.rs            existing scalar-to-PostgreSQL bindings
cold_tier/merge.rs              deterministic hot/cold merge
```

Keep the shared compiler; do not fork authorization/pagination semantics into independently evolving STDB and PG implementations. Preserve `cold_tier::ResourceReadPlan`, `compile_pg_sql`, `compile_stdb_sql`, and other existing imports through re-exports. This task must be accepted before concurrent cold-tier child conversions begin.

### F. Projection application and worker

```text
cold_tier/commit_projection/
  mod.rs                 public types and apply_commit re-export
  apply.rs               sole transaction owner, ledger/row writes, watermark
  prepare.rs             manifest decoding, validation and prepared changes
  sql.rs                 statement construction and identifier handling
  checksum.rs            canonical JSON and unchanged checksums
  tests/{mod,validation,postgres,fixtures}.rs
cold_tier/projection_worker/
  mod.rs                 startup, lifecycle and public re-exports
  drain.rs               bounded cursor iteration and per-organization application
  source.rs              cursor/commit/change fetching and watermark lookup
  decode.rs              wire row decoding
  status.rs              failure classification and status recording adapters
  relations.rs           existing relation metadata, validation and DDL
```

The worker delegates atomic application to `commit_projection::apply_commit`. Its status helpers continue using `projection_observability`; do not duplicate that subsystem. Extract a per-organization drain operation rather than merely relocating the approximately 350-line batch function. Preserve cursor fairness, gap/quarantine classification and retry behavior.

`apply.rs` retains transaction acquisition, watermark lock, sequence/checksum checks, ledger/change writes, row application, watermark update and commit. Helpers receive the existing transaction; they cannot independently acquire/commit one.

Preserve relation setup callers, including the opt-in PostgreSQL matrix. Moving DDL code is not permission to change migration/adoption behavior. Keep `pg_codec` as the shared codec implementation.

### G. Reconstruction

```text
cold_tier/reconstruction/
  mod.rs                 public re-exports
  catalog.rs             restore catalog and manifest validation
  protocol.rs            existing source/sink traits and exchanged types
  coordinator.rs         reconstruction sequencing and failure handling
  postgres_source.rs     PgReconstructionSource
  stdb_sink.rs           StdbReconstructionSink
  integrity.rs           identity/order/checksum/digest validation
  tests/{mod,catalog,reconstruction,replay,support}.rs
```

Preserve server-controlled organization, placement, store, table set and watermark. The coordinator retains the full acquire/validate/restore/verify/recreate/verify-release/release sequence. Failure retains the fence, and exact retries retain receipt/idempotency semantics. Reuse current traits without inventing a new abstraction framework.

### H. Workflow and realtime

```text
workflow_reads/
  mod.rs                 public entry points and explicit dispatch
  candidate_scope.rs     candidate roles/groups/units and delegation authorization
  human_tasks.rs         inbox reads, task/event projection and visibility
  definitions.rs         workflow/version/node reads and their redaction
  operations.rs          operational, migration, outbox and decision views
  company_scope.rs       workflow-specific company resolution and row checks
workflow_worker/
  mod.rs                 serve/cycle, org discovery and worker registration
  timers.rs              due timers, revision reads and firing
  outbox.rs              claim, adapter invocation, result recording, completion
  adapter.rs             external delivery, allowlists and fingerprint mode
  tests/                 existing tests and test-only crash/replay support
realtime/
  mod.rs                 public handlers/re-exports and generated adapter seam
  subscription.rs        request validation, authorization and SQL planning
  bridge.rs              STDB connection, callback registration and events
  socket.rs              handshake, message forwarding and connection lifecycle
```

Avoid merging workflow-specific company policy with general query policy until equivalence is demonstrated. Keep authorization and response redaction owned by the relevant read groups. Preserve current compatibility-resource responses and routing precedence.

Keep outbox sequencing explicit. Test helpers model behavior but are not proof that production follows it; retain them and review the actual dispatch path. Preserve timer discovery, configured organization selection, dispatch defaults, allowlists, leases and shutdown behavior.

Realtime subscriptions remain authorized invalidation signals; do not forward privileged row payloads to browsers. Preserve session/company validation before subscription creation and existing client-token selection. `api-server/build.rs` generates callbacks referring to `crate::realtime::notify_row_change`; retain that seam or update and verify the generator in a coordinator-owned change. Preserve SDK/thread/channel cleanup and message contracts.

### I. Later supporting modules

```text
routes/crm/{mod,leads,contacts,contact_identities,contact_roles}.rs
routes/documents/{mod,financial,sales,accounting,pivot,attachment}.rs
document_render/{mod,financial,pdf,xlsx,csv}.rs
platform_control/{mod,schema,credentials,profiles,password_resets,service_identities}.rs
```

CRM request conversion stays with its handler group. Shared pagination helpers may remain small and local.

For documents, handlers/loaders live under `routes/documents`; reusable pure format/rendering code lives under `document_render`. Create children only where real code exists. Retain the current printpdf and Chromium paths; renderer unification is a separate behavior change. Do not move unrelated `document_blobs` storage into rendering modules.

For platform control, preserve atomic operations that affect credentials and profiles together; assign each operation one owner rather than splitting its transaction across files. Keep `PlatformId` and existing public functions reachable through `platform_control` re-exports. Preserve schema SQL exactly.

## 6. Task graph and ownership

Every task starts with a current source inventory and ends with coordinator acceptance. `PENDING` means no implementation evidence has been recorded.

| ID | Assignment | Dependencies | Exclusive implementation scope | Status |
| --- | --- | --- | --- | --- |
| M00 | Baseline, ownership ledger, test inventory | None | Coordinator; read-only baseline plus ledger | PENDING |
| M01 | Repair resource dispatch audit and negative fixtures | M00 | Coordinator or delegated tooling owner; `lumiere-codegen/src/query_exec_audit`, relevant path wiring | PENDING |
| M02 | Extract existing test modules/helpers | M00 | One source module per assignment; coordinate destinations with later owner | PENDING |
| M10 | HTTP assembly, query/operation adapters, commands | M00 | `http_app`, new HTTP adapters and `commands`; coordinator wires shared roots | PENDING |
| M11 | Authentication flow modules | M00 | `routes/auth.rs` and `routes/auth/` | PENDING |
| M12 | Report service modules | M00 | `reports/service.rs` and `reports/service/` | PENDING |
| M13 | Report renderer modules | M12 | `reports/render.rs` and `reports/render/` | PENDING |
| M20 | Query support and authoritative modules | M01, M10 | `query_exec` conversion; coordinator owns dispatcher and root exports | PENDING |
| M21 | Query domain extraction batches | M20 | One domain transfer at a time from dispatcher to named owner | PENDING |
| M30 | Cold read foundation | M00 | Coordinator-owned `cold_tier/mod.rs` conversion and new foundation files | PENDING |
| M31 | Atomic commit projection modules | M30 | `cold_tier/commit_projection` conversion | PENDING |
| M32 | Reconstruction modules | M30 | `cold_tier/reconstruction` conversion | PENDING |
| M33 | Projection worker modules | M31 | `cold_tier/projection_worker` conversion | PENDING |
| M40 | Workflow reads | M21 | `workflow_reads` conversion | PENDING |
| M41 | Workflow worker | M00; M02 for this file if assigned | `workflow_worker` conversion | PENDING |
| M42 | Realtime modules | M21, M10 | `realtime`; coordinator retains build-script integration | PENDING |
| M50 | CRM route modules | M21 | `routes/crm` conversion | PENDING |
| M51 | Document adapters and renderers | M13, M21 | `routes/documents`, `document_render`; coordinator declares root | PENDING |
| M52 | Platform control modules | M11 | `platform_control` conversion | PENDING |
| M60 | Session/org extractor and selected caller migration | M10, M11, M21 | Coordinator stages `web_session` plus selected callers | PENDING |
| M90 | Integrated review, tests, docs and final handoff | All required tasks | Coordinator | PENDING |

M02 is opportunistic: if extraction would cause double-moving tests, fold it into the relevant module task and record that decision. Never run M02 concurrently with its production module owner.

Suggested batches, subject to actual file ownership and available slots:

1. Coordinator completes M00/M01 and prepares public interfaces. Independent agents may handle M11, M12, or a bounded M02 while the coordinator works on audit repair.
2. Accept M10/M11/M12, then M13. M30 is a coordinator-owned batch because it changes a shared root.
3. M20 then M21 proceeds through small domain transfers. Independent cold work M31/M32 can run alongside query work once M30 is accepted; M33 follows M31 acceptance.
4. After query boundaries settle, run M40, M42 and M50 as disjoint assignments. Schedule M41 wherever its source is unowned.
5. Finish M51/M52/M60, then M90. Do not launch more tasks just to occupy all agent slots if the coordinator has unreviewed work waiting.

Use separate reviewable local changes or PR-sized batches. Creating, publishing, or merging remote PRs follows the user's implementation-session authorization; it is not required to prove local integration.

## 7. Verification and evidence

### Baseline and execution discipline

- Record branch/revision, dirty files, dependency pin, compiler/toolchain, and current test commands. Preserve unrelated edits; the authoring checkout contained untracked `scripts/__pycache__/`, which is outside this plan.
- Inspect running work before taking the single Cargo slot. Reuse current caches and services. Do not launch multiple full builds or rebuild STDB/web for Rust-only file moves without a source/dependency reason.
- Existing formatting drift and warnings are baseline findings, not permission to reformat the whole repo or delete test support.
- Keep tests as `#[cfg(test)]` child modules when they need private access. Move them to integration tests only when testing an actual public boundary. Verify discovery after module moves.
- Add tests for uncovered externally meaningful behavior and the audit bug; do not add tests that only assert file layout or mirror helper implementation.

Focused commands available at authoring time (confirm names after extraction):

```sh
cargo check -p api-server
cargo test -p lumiere-codegen query_exec_audit
cargo test -p api-server --lib -- --list
cargo test -p api-server --test session_auth
cargo test -p api-server --lib query_exec::
cargo test -p api-server --lib reports::
cargo test -p api-server --lib cold_tier::
cargo test -p api-server --lib workflow_reads::
cargo test -p api-server --lib workflow_worker::
cargo test -p api-server --lib realtime::
```

Run the relevant filters for each batch, not the whole list every time. A filter running zero tests is not acceptance. Use the discovered test list for moved paths. Run targeted rustfmt/checks on changed modules without rewriting unrelated files.

### Behavior gates by area

| Area | Evidence required before acceptance |
| --- | --- |
| Audit | Intended dispatcher selected despite earlier unrelated functions/matches; unknown/misspelled and stale virtual keys rejected; extracted dispatch still fully covered |
| HTTP/auth | Route/method inventory preserved; relevant session-auth and command validation tests pass; cookie settings and middleware order reviewed; named/positional formats retained |
| Queries | Cross-org and cross-company rejection, self-only/parent visibility, field stripping, workflow precedence, handled-empty vs unknown distinction, ordering and Option/enum/u64 behavior preserved for moved domains |
| Reports | Catalog keys, typed aggregate outputs, query bounds, currency/window rules, escaping and HTML output retained; renderer transport remains separately testable |
| Cold reads | Existing STDB/PG SQL expectations, scope/predicate grouping, parameter order, pagination and merge tests pass |
| Projection | Sequence gaps, duplicate/conflicting commits, checksums and tenant guards preserved; actual PostgreSQL transaction matrix executed on a designated test database |
| Reconstruction | Catalog ordering, exact watermark, wrong-tenant/invalid-fence rejection, replay/receipt behavior, retained fence on failure and release after verification preserved |
| Workflow | Candidate/delegation visibility and redaction preserved; existing five replay tests retained; production lease/result/completion and shutdown sequence reviewed independently |
| Realtime | Resource/company denial, subscription SQL compatibility, generated callback wiring, invalidation-only messages and socket/SDK lifecycle preserved |
| Supporting routes/platform | Endpoint contract and relevant domain tests retained; document bytes/format semantics stable; credential/profile transactions and schema SQL unchanged |

The opt-in projection matrix currently requires `C3_TEST_PG=1` plus repository-supported PostgreSQL configuration. Run it only against a designated development/test database, verify that the environment gate was enabled, and record test name and actual execution. A default test run can report success while this matrix returns early; that is not PostgreSQL evidence. Reconstruction fake-based tests do not establish a live STDB-loss recovery result; retain any existing live recovery checks and state their actual coverage.

At M90, run one integrated API-server library suite and relevant integration tests after the last integration. Verify all binaries still compile. Do not claim a green full suite if it was interrupted, skipped, or blocked. Capture focused failures and avoid repeated builds without new evidence.

`make check-codegen` is not a cheap read-only check: it invokes generation/schema prerequisites and contains index operations. Use the focused audit tests during file extraction. The coordinator runs the broader repository gate at the appropriate final integration point, in a suitable clean validation checkout if needed, and reviews any generated/index changes. Structural changes should not alter schema/operation/resource contracts or require a new contracts release. Report pre-existing drift separately and do not change pins or artifacts just to hide it.

### Completion record per task

Append beneath this section or link a task-specific record containing:

```text
Task ID / owner / coordinator reviewer:
Base and integrated revision (or patch identity):
Old files -> new responsibilities:
Public API and shared wiring changes:
Behavior differences: none, or separately approved change reference
Tests discovered / executed / passed / failed / skipped:
External test services and gates actually enabled:
Baseline failures vs introduced regressions:
Review findings and resolutions:
Status: pending | active | review | accepted | blocked
Next dependency or blocker:
```

Keep this record concise; do not paste entire build logs. `accepted` requires coordinator review and integrated validation, not merely subagent completion. At session handoff, record active owners, unfinished edits, Cargo slot state and the exact next task.

## 8. Separate behavior-change follow-ups

These findings remain useful, but must not be bundled invisibly into file moves:

- Redact internal HTTP error details while preserving source chains in logs; migrate error conversion in a focused change. `From<anyhow::Error>` does not automatically convert every other error type transitively.
- Replace silent proposal mock success with an explicitly designed failure/development/degraded behavior.
- Handle fallible PDF rendering without request-path `expect`, preserving response contracts.
- Remove truly unused credential lookup or redundant DTO fields after checking all callers, deserialization requirements and selected columns.
- Consider generated resource typing and metadata-driven handling only after dispatch ownership is explicit and measured duplication warrants it.
- Consider renderer convergence, broader JSON normalization, or shared worker abstractions only as separately reviewed designs.

The implementation coordinator records these separately and follows the user's authority for behavior changes. Discovering one does not justify broadening a structural assignment.

## 9. Final definition of done

- All in-scope tasks are accepted or explicitly deferred by the user. If any required task is blocked or unfinished, report the plan as incomplete with concrete blockers; no silent omissions.
- Replacement modules have named responsibility owners, narrow interfaces, and no cyclic domain dependencies or replacement catch-all files.
- Public entry points, endpoint behavior, registry/contract provenance, authorization, transaction and fence semantics are preserved.
- Tests and fixtures were retained, discovered and run where required; actual PostgreSQL evidence is distinguished from skipped and fake-based tests.
- The coordinator reviewed and integrated every subagent contribution into the codebase and resolved introduced regressions.
- Final git diff contains only scoped work, with unrelated user changes preserved and generated changes explained.
- Final handoff lists completed batches, intentional deferrals, verification results and remaining release blockers. It does not equate refactoring with production readiness.
