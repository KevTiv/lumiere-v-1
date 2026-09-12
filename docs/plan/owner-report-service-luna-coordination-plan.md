# Owner-report service: coordinator and Luna execution plan

Status: LOCAL IMPLEMENTATION COMPLETE; G0-G3 passed, G4 disposable runtime proof blocked on the stopped local Docker/OrbStack fixture.
Created: 2026-09-07. Execution baseline: `45250a400`; the plan itself was the only dirty path when Wave 0 began.
Execution owner: primary coordinating agent; implementation agents: `gpt-5.6-luna`.

## Objective

Complete three changes within the existing API-server crate:

1. Move report artifact persistence out of HTTP routes into the reports module.
2. Give interactive PDF exports and scheduled jobs one shared preview, render, and persistence sequence.
3. Represent user and scheduled-job authority explicitly, preserving tenant validation, permission checks, masking, credentials, and provenance.

Keep Axum and Tokio. This is a report-specific refactor, not a new runtime, service, queue framework, or repository-wide architecture migration. Writing this plan does not start implementation. A request to execute it authorizes the local implementation, bounded Luna delegation, integration, and checks described here. Remote publication and production operations are outside this plan.

## Current implementation and evidence

Paths below are relative to the repository root.

| Current owner | Observed behavior | Intended change |
| --- | --- | --- |
| `api-server/src/reports/service/mod.rs` | `preview_report` builds typed reports; shared by route and worker | Reuse the existing implementation |
| `api-server/src/reports/render/chromium.rs` | `render_pdf` sends typed-report HTML to the Chromium renderer | Reuse the existing implementation |
| `api-server/src/routes/reports.rs` | `pdf_post` coordinates access, preview, masking, render, and persistence | Delegate report execution; retain HTTP/session handling |
| Same routes file | `record_generated_report`, `RecordedOwnerReport`, artifact path and filesystem helpers own persistence | Move to `reports/artifacts.rs`; download route also uses the new owner where needed |
| `api-server/src/owner_report_worker.rs` | `process_job` repeats generation steps and imports persistence from routes | Call the shared operation; retain queue/run lifecycle and date selection |
| `api-server/src/reports/auth.rs` | Report/source access checks and field masking | Preserve rules and make their application explicit at the shared boundary |
| `api-server/src/reports/service/source_queries.rs` | Request validation and company/organization-scoped lookup | Preserve these checks for both callers |

The HTTP preview endpoint currently uses `state.stdb`, while HTTP PDF export uses the session-token client. The scheduled worker uses the server client and passes its configured worker name into the preview identity parameter. Do not normalize these differences without tracing their purpose.

The worker's access is not established merely by adding an enum variant. Trace schedule creation, dispatch, job claim, organization/run binding, and completion through `spacetimedb/src/analytics/reports.rs` and `spacetimedb/src/core/queue.rs` before defining its execution context. This inspection is not a claim that scheduled authorization has already been verified.

## Coordinator operating rules

- Refresh branch, working-tree diff, applicable instructions, relevant concurrent work, callers, and tests before dispatch. Record the new baseline below.
- Preserve existing unrelated modifications. At planning time these included Cargo manifests/lockfile, admin/pack/statement routes, projection observability, and workflow reads; this inventory can change.
- Use at most three Luna subagents concurrently, keeping the fourth slot for the coordinator. Explicitly select `gpt-5.6-luna`; use a bounded prompt with sufficient context rather than a full-history fork when overriding the model.
- The coordinator owns this plan, the execution ledger, `reports/mod.rs`, integration decisions, and all Cargo/codegen commands. Reserve manifests, lockfile, generated files, router roots, and unrelated modules from subagent edits.
- Give each writable file exactly one owner at a time. Shared checkout edits are immediately visible; ownership is not patch isolation. Reassign ownership only after the previous agent finishes and its diff is reviewed.
- Agree exported signatures and authority semantics before dependent implementation. Do not ask parallel agents to invent competing context/result types.
- Run one Cargo validation job at a time. Subagents return proposed checks and may run non-Cargo checks within their ownership. Avoid broad formatting and never restore unrelated files.
- Read returned diffs and surrounding code. Resolve task-caused failures and continue integration; a subagent's summary is not acceptance evidence.
- Keep `ApiError` and `AppState` where currently useful. Removing all HTTP-related type dependencies, inventing service traits, or splitting crates is not required for reuse.

## Wave 0: three independent read-only audits

The coordinator records the baseline and existing relevant test results while the audits run.

| Luna assignment | Read scope | Required return |
| --- | --- | --- |
| A — persistence | Route persistence/download helpers, artifact provenance, recording reducer, existing tests | Exact extraction set, callers, filesystem/error behavior, correlation/hash rules, and any pre-existing retry/cleanup hazards |
| B — authority | Report auth, session resolution, worker registration/claim, schedule reducers, company validation | User-versus-worker authority matrix; source of each trusted field; missing validation if any; proposed narrow context constructors |
| C — orchestration and verification | PDF/preview handlers, worker generation/completion, renderer and focused test infrastructure | Shared sequence, caller-specific behavior, failure-order matrix, reusable test fixtures and runtime prerequisites |

No audit edits production files. Each return lists verified facts with paths, unresolved questions, and a recommended smallest change. No additional delegation is needed inside these assignments.

### Gate G0 — freeze the implementation contract

The coordinator resolves audit findings into a written contract in the ledger:

- Artifact module exports and callers, including download-path helpers.
- Shared operation inputs: trusted execution context, typed report key/request, and existing dependencies.
- Shared result: PDF bytes and recorded artifact identity, using existing types where possible.
- User context comes from the resolved session and carries organization, identity, field access, and the appropriate client. Tenant identity is never taken from the request body.
- Scheduled context comes from the validated claimed job and trusted configuration, including organization, run identity, and worker provenance. Arbitrary callers must not construct privileged authority from unchecked payload fields.
- Represent the two execution modes explicitly with narrow visibility and validated construction. No `skip_auth`, `is_admin`, or `None`-means-worker convention. Construction visibility alone does not validate a job.
- Shared execution applies the appropriate report policy and masks interactive data before rendering/persistence. Preserve existing production versus development rules; do not silently broaden or tighten them during extraction.
- Keep organization/company validation effective for both modes. Document whether the worker acts as a service or as a delegated user from actual reducer evidence; do not invent impersonation.
- Preserve report parameters, source watermark, output hash, schema/renderer versions, correlation suffixes, and provenance identity.
- Permission, rendering, or persistence failures cannot produce successful HTTP exports or successful scheduled completion.
- Preview-only HTTP requests must continue to avoid PDF rendering and artifact writes. Only reuse a policy helper there if it removes duplication safely.

If the audit discovers an authorization defect, record it as a separate, explicit corrective slice with a reproducing check before dependent integration. Do not encode an insecure behavior as the desired contract, change generated contracts silently, or call the original defect fixed by moving code.

## Wave 1: persistence extraction and authority implementation

After G0, run these two implementation tasks concurrently; the third Luna slot can refine the test matrix read-only.

### Luna A — move artifact ownership (point 1)

Exclusive write ownership: new `api-server/src/reports/artifacts.rs` and `api-server/src/routes/reports.rs` for this wave only.

- Move persistence types/helpers into the new module, updating both export and download uses.
- Preserve artifact naming, hash, metadata, reducer parameters, lookup behavior, error mapping, and correlation semantics.
- Return the exact worker import change to the coordinator, who applies it and wires `reports/mod.rs` after reviewing the move.
- Do not introduce async filesystem rewrites, atomic-write redesigns, or retry changes in the mechanical move. Report discovered defects separately.
- Include focused persistence regression coverage using existing infrastructure; do not add a dependency for a file move.

### Luna B — explicit execution authority (point 3)

Exclusive write ownership: new `api-server/src/reports/execution_context.rs`; existing `reports/auth.rs` only if G0 assigns a necessary change there.

- Implement the agreed context and construction rules, with minimum visibility and documentation of trusted inputs.
- Reuse existing report policy and field-access types. Keep session/cookie extraction and job parsing outside the shared business operation.
- Verify user-denial paths, missing field-access behavior, and scheduled-context validation at their actual trust boundaries.
- Do not change reducers, credentials, permissions, or report masking rules as an incidental refactor.

### Gate G1 — integrate the foundation

Coordinator wires modules/imports, reviews context construction and extraction diffs, runs focused checks, and releases route-file ownership. Acceptance requires no worker import from `routes::reports`, one persistence implementation, and validated authority semantics. A broad baseline build failure is documented separately from changes introduced here.

## Wave 2: shared generation and both callers

Coordinator freezes concrete function signatures and adds module wiring before dispatch. Agents may edit against the agreed signatures; integration builds run only after all three returns.

| Luna assignment | Exclusive write ownership | Work |
| --- | --- | --- |
| A — shared generation (point 2) | New `api-server/src/reports/generation.rs` | Implement one policy → preview → applicable masking → render → persist sequence; return PDF bytes and artifact identity; retain errors until adapters map them |
| B — HTTP integration | `api-server/src/routes/reports.rs` | Resolve session/parse inputs, construct user context, call the operation, return existing HTTP response; keep preview-only and download semantics intact |
| C — worker integration | `api-server/src/owner_report_worker.rs` | Validate/construct scheduled context, call the operation, use returned artifact for run completion; retain date selection, claim, failure handling, and queue completion order |

Each agent adds meaningful tests within its files or an exclusively assigned test file. Changes to G1 files require coordinator ownership transfer, not opportunistic edits. The coordinator verifies that context construction is exercised in both adapters and that no caller retains an alternative unguarded generation path.

### Gate G2 — combined behavior

- Both PDF entry paths use the same generation operation and persistence owner.
- HTTP adapters contain transport/session handling; workers contain scheduling and queue lifecycle.
- Interactive masking occurs before rendering and saving; scheduled policy follows the G0 evidence.
- Successful scheduled completion still follows successful artifact recording, with the original identifiers.
- Error status/body mapping, content type, date/timezone rules, artifact provenance, and scheduled correlation remain compatible.
- No new runtime, process, dependency, schema change, or generated-contract release is required by the structural changes.

## Wave 3: independent review and acceptance

Reassign Luna reviewers after implementation returns: one reviews the other agent's authority/caller work, one reviews persistence and failure ordering, and one reviews coverage and accidental scope growth. These are read-only reviews while the coordinator inspects the combined diff and runs checks. The coordinator assigns any fixes with exclusive ownership and reruns only affected checks.

Required behavioral coverage:

| Case | Evidence required |
| --- | --- |
| Authorized user export | Existing access checks pass; masked report reaches renderer; artifact saved; PDF response returned |
| Denied user/missing production authority | Rejected before renderer or artifact side effects |
| Different-organization company | Rejected in both applicable execution paths |
| Invalid scheduled context | Malformed/unbound run or organization rejected at the audited boundary; cannot manufacture privileged context through HTTP |
| Valid scheduled job | Worker provenance and scheduled-run correlation retained; artifact precedes run and queue completion |
| Renderer or persistence failure | No successful export/run completion; existing failure handling preserved |
| Preview request | Existing preview permissions/masking preserved; no renderer or persistence calls |
| Artifact download | Existing authorization, lookup, and path behavior preserved after extraction |
| Repeated job/artifact attempt | Existing correlation and durable behavior verified; do not claim idempotency from a unit test or hash naming alone |

Use the repository's existing seams and fixtures. Do not introduce a general dependency-injection framework solely for these tests. Unit tests establish local policy/sequence behavior; service-backed tests establish persistence and reducer behavior.

Coordinator validation, serially:

1. Review `git diff --check` for touched paths and scoped Rust formatting; separate pre-existing formatting debt.
2. `cargo check -p api-server --all-targets` against the coherent integrated tree; compare failures with baseline.
3. Run focused existing and new report/auth/worker tests. Starting filters: `cargo test -p api-server --lib reports::` and `cargo test -p api-server --lib owner_report_worker::`. Record discovered test names/counts so a zero-test filter cannot pass the gate.
4. Run affected HTTP/integration tests and source-inspecting checks discovered in Wave 0. Keep canonical codegen inputs untouched; report any unexpected dependency on moved source paths.
5. On a disposable test fixture, exercise one authorized and one denied HTTP export plus one scheduled run, then inspect persisted artifact/provenance and run/job status. Exercise failure cases using the existing test infrastructure. Never substitute a production queue or tenant.

If the disposable SpacetimeDB/renderer fixture is unavailable, finish all independent implementation and local checks, record the exact missing prerequisites and reproducible next command, and mark runtime acceptance pending. Local compilation does not establish persisted behavior, PDF fidelity, or deployment readiness.

## Delivery and resumable ledger

Logical review slices: (1) persistence move, (2) authority plus shared operation and both callers, (3) remaining behavioral proof/corrections. Keep compilable integration points; do not publish an unused authorization design as evidence that callers enforce it. Commit, push, and PR actions follow the execution session's authorization.

The coordinator updates this table after every gate; add command output summaries and precise file references below it.

| Gate | Status | Evidence / remaining work |
| --- | --- | --- |
| G0 baseline, audits, frozen contract | Complete | Baseline `45250a400`; `cargo test -p api-server --lib reports::` 31/31 and `cargo test -p api-server --lib owner_report_worker::` 1/1. Three read-only audits completed. Frozen contract and corrective slices are recorded below. |
| G1 persistence and context | Complete | Added `reports/artifacts.rs` and `reports/execution_context.rs`; route persistence moved and worker no longer imports routes. `cargo check -p api-server --all-targets` passed with only expected pre-G2 unused-context warnings. `cargo test -p api-server --lib reports::` passed 39/39 (31 baseline plus 8 new artifact/context tests). |
| G2 shared operation and adapters | Complete | Both HTTP PDF export and the scheduled worker call `reports::generation::generate_owner_report`. Interactive authority is constructed from the resolved session client; scheduled authority requires a claimed queue row plus reloaded run/schedule evidence. Preview-only and download handlers remain separate. Artifact recording precedes run and queue completion. |
| G3 local checks and independent review | Complete | Three independent reviews found and corrected queue-contract drift, retry/hash ambiguity, foreign-company schedule acceptance, weak scheduled completion binding, completed-run failure overwrite, and expired-lease starvation. `git diff --check`, scoped formatting, `cargo check -p api-server --all-targets`, 43/43 `reports::` tests, 8/8 `owner_report_worker::` tests, and 3/3 scoped native scheduled-owner-report reducer tests pass. Standalone SpacetimeDB compilation retains unrelated pre-existing warnings. |
| G4 disposable persisted/runtime proof | Blocked on local fixture | Local compilation and unit checks do not prove persisted HTTP/queue behavior or PDF fidelity. `docker ps` could not connect to `/Users/kevintivert/.orbstack/run/docker.sock`, so no disposable services were running. Requires a disposable published SpacetimeDB module with authorized and denied session fixtures, the Chromium worker, API server, owner-report worker, and a disposable artifact volume. After starting the Docker/OrbStack daemon, run `docker compose -f docker-compose.dev.yml up spacetimedb chromium-worker api-server owner-report-worker`, then exercise one authorized export, one denied export, one valid scheduled run, one renderer failure, and one repeated/reclaimed job while inspecting artifact provenance and run/job status. |

Every handoff records: baseline SHA and dirty files; agent/file ownership; agreed signatures and policy; completed gate; changed paths; exact checks and results; newly found versus pre-existing defects; next bounded assignment. Mark the three implementation points separately from G4 acceptance.

### G0 frozen implementation contract — 2026-09-07

- Artifact ownership moves mechanically from `routes/reports.rs` to `reports/artifacts.rs`: `RecordedOwnerReport`, `record_generated_report`, `artifact_path`, and `persist_artifact`. The artifact key remains the full PDF SHA-256 plus `.pdf`; reducer hash, renderer version, parameters, watermarks, correlation formats, cleanup behavior, and download validation remain unchanged in this slice.
- Interactive authority is a private-variant context constructed from a resolved `ApiSession` and its session-token client. It carries the session-owned organization, actor identity, and field-access policy. Request bodies cannot supply organization or actor identity.
- Scheduled authority is a private-variant context constructed only after the server-token worker has claimed a queue row and compared its organization/company/job binding with the persisted scheduled run and schedule. The context carries organization, run ID, worker provenance, and the server client. A worker name or unchecked payload cannot construct scheduled authority.
- The shared generation operation accepts `AppState`, explicit execution authority, a typed `ReportKey`, and `ReportPreviewRequest`. It performs mode-appropriate policy, preview, interactive masking, Chromium rendering, and artifact recording in that order. It returns PDF bytes plus `RecordedOwnerReport`.
- Interactive generation preserves `ReportAccess::Export`, session-token queries, field masking before render/persist, and hash-derived correlation. Scheduled generation preserves the server-token client, date/timezone selection, worker provenance, and `scheduled-run-{run_id}` correlation. The worker remains a service identity; it does not impersonate a recipient or schedule creator.
- Preview-only HTTP requests remain outside the shared render/persist operation and retain their current client, access check, masking, and zero-side-effect behavior. Download authorization and lookup remain in the HTTP adapter while filesystem ownership moves to the artifact module.
- Scheduled-run and queue completion remain after successful artifact recording. Permission, preview, render, or persistence failure cannot yield successful HTTP or scheduled completion.

### G0 discovered corrective slices and limitations

1. **Immediate prerequisite:** `owner_report_worker.rs` uses retired positional queue claim/completion calls. Before G2 acceptance it must retain queue revision and registered worker ID, create a bounded opaque lease, call the current parameterized reducers, and use a stable success fingerprint or explicit failed outcome. Focused tests must cover argument shape, revision progression, and failure completion.
2. **Scheduled binding hardening in this refactor:** before generation, reload the scheduled run and schedule and compare organization, queue job, company, report key, and timezone with the claimed job payload. Reject mismatch before renderer or artifact side effects.
3. **Pre-existing C9 trust-boundary work:** session JWT claims are decoded locally without signature verification before fallback membership resolution; inactive platform profiles and `org_permission` deny semantics are not fully represented in `FieldAccessContext`. This refactor must not widen those behaviors and cannot claim C9 completion. Cryptographic session binding and unified permission resolution remain explicit C9 prerequisites.
4. **Reducer hardening follow-up:** schedule creation does not reject a foreign company until enqueue, and scheduled completion does not independently bind artifact/document/company/correlation to the run. These are recorded defects outside the API-only mechanical extraction; runtime acceptance remains pending until reproduced and corrected or explicitly accepted.
5. **Persistence limitations preserved for reviewability:** writes are non-atomic, existing files are not rehashed, cleanup is best-effort, and a successful reducer followed by failed readback leaves durable state. No new idempotency claim is made.

### G2-G3 integration evidence — 2026-09-07

- `reports/artifacts.rs` is the single owner of artifact persistence and path validation. Correlation retries now compare the persisted `output_hash`; an existing correlation with different bytes fails with `409 Conflict`, and cleanup never targets the already-recorded artifact key.
- `reports/generation.rs` is the single render-and-record operation. The HTTP PDF adapter constructs `InteractiveReportContext` from the resolved `ApiSession` and matching session-token client. The worker constructs `ScheduledReportContext` only after claiming the current revision and reloading queue/run/schedule facts.
- The worker now uses the current composite queue claim/completion parameters, an opaque bounded lease, deterministic output-hash success fingerprints, separate bounded pending and expired-lease recovery selections, and completed-run recovery without rerendering or duplicating persistence.
- Failure handling revalidates the full queue/run/schedule binding before marking a scheduled run failed. Completed or artifact-bearing runs cannot be overwritten by the failure path; queue completion remains a separate lease-bound operation.
- Schedule creation validates an optional company against the organization. Scheduled-run completion independently validates the schedule, generated report, document, organization/company, report key, document linkage, and exact scheduled-run correlation. An already-completed run is idempotent only for the same artifact and document IDs.
- Verification was serialized: `cargo check -p api-server --all-targets` passed; `cargo test -p api-server --lib reports::` passed 43 tests; `cargo test -p api-server --lib owner_report_worker::` passed 8 tests; `cargo test --manifest-path spacetimedb/Cargo.toml scheduled_owner_report` passed 3 tests (plus a zero-test filtered harness binary, which is not counted as evidence).
- No reducer signature, generated file, manifest, lockfile, runtime, or contract pin changed. Therefore no contract generation, publication, or pin update is required for G2-G3.

## Copy/paste execution prompt

```text
Execute docs/plan/owner-report-service-luna-coordination-plan.md.
Act as the coordinator and use gpt-5.6-luna subagents with at most three
running concurrently. Begin with the current-tree baseline and the three
read-only audits. Freeze the authority and function contracts before
implementation; use exclusive file ownership and serialize Cargo/integration.
Complete all three implementation points, inspect every returned diff, fix
task-caused failures, run the prescribed checks, and update the ledger after
each gate. Preserve unrelated changes and existing tenant, masking,
credential, provenance, HTTP, and queue behavior. Do not introduce a new
runtime or publish contracts. Report implementation and persisted-runtime
acceptance separately, with exact outstanding prerequisites if necessary.
```
