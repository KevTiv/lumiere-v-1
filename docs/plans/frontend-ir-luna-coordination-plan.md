# Remaining frontend IR work — Luna coordination and delivery

**Status:** First implementation slice in progress — 2026-09-12
**Baseline:** `06c9c82a00e8cdaf9a07f2363786b6d5f043a88f` on `main`; application contracts pinned to v0.3.40.
**Parent:** [Frontend multi-surface architecture](./frontend-multisurface-workflow-presentation-plan.md)
**Related:** [Typed BFF SDK](./typed-bff-sdk-contract-hardening-execution-plan.md), [Overview](./overview-dashboard-subagent-plan.md), [Onboarding](./organization-onboarding-workflow-subagent-plan.md)

## Outcome and current scope

Deliver the remaining contract and presentation work as small reviewed PRs with independently recorded gates. The first PR extracts a static, serializable Overview dashboard definition into a renderer-neutral package and adapts it to the existing web dashboard. It also reconciles the remaining roadmap against the current code.

This first slice is partial F0/F1 work. It does not complete F0's full model inventory, the F0.5 admin publishing proof, F1's workflow/WorkProgram proof, or the F2 paired web/mobile proof. Static developer-authored presentation data must not be exposed as an unvalidated runtime admin configuration endpoint.

**Direction update (2026-09-12):** Subsequent delivery targets user/harness-authored modules and pages, not a repository-wide sequence of dashboard extractions. The parent plan's sections 3.8–3.11 define module/page ownership, the ERP dictionary, the common publication path and extension boundaries. Keep the Overview PR as the renderer proof; prioritize the dictionary and composition host, then a human-authored module and a sandbox-backed harness extension before expanding mobile coverage.

## Current-tree audit

| Area | Verified source evidence | Remaining work |
| --- | --- | --- |
| IR command contracts | `frontend/packages/stdb/src/commands/stdb-http.ts` consumes generated descriptors and input types; the SDK owns a handwritten business façade | Remove only proven obsolete compatibility machinery; retain current metadata consumers |
| Typed reads | `resource-reads.ts`, `sdk.ts`, and typed loaders in `query-hooks/src/hooks/stdb.ts` use generated runtime codecs | Classify additional resources before migrating them; generic query reads still use a typed cast |
| Company scope | `organization-company.ts` calls the organization-wide companies SDK; company-bound accounting reads use separate typed loaders | Keep organization-wide companies distinct from company-selected resources; preserve cache scope and invalidation |
| Domain command files | `commands/*-http.ts` supply reducer lists, metadata, and subscription/invalidation hints | The old instruction to delete all domain helper files is obsolete; establish executable and metadata consumer counts per symbol |
| Type debt | `frontend/type-debt/opaque-record-policy.json` and its baseline enforce a per-file ratchet | Existing debt remains; boundary-only completion is a later gate |
| Web presentation | `ui/src/lib/dashboard-types.ts` supports React values, callbacks, and layout widths; Overview already uses `DashboardGrid` | Extract semantic intent without carrying web-only behavior into shared definitions |
| Onboarding | `web/app/(auth)/onboarding/page.tsx` owns a bootstrap form and `/api/bootstrap/tenant` request | Reconcile actual bootstrap state and idempotency before defining a shared workflow; do not invent extra business steps |
| Mobile | `frontend/mobile` already exists as an Expo starter/probe | Reuse it for shared semantic fixtures; do not create a second Expo app |
| Runtime composition | Report dashboard/widget persistence exists | It is not immutable presentation publishing, rollback, audit, or authorization proof |

Paths above are repository-relative evidence locations, not assertions that the full runtime acceptance suite has passed.

## Coordination protocol

Use a coordinator plus at most three Luna agents. Refresh branch, working-tree changes, contract pin, and this ledger at every session. Each assignment has exact file ownership, inputs, output, and validation scope. Agents do not edit another lane's files or regenerate contracts.

1. Audit lanes independently; reconcile findings before freezing interfaces.
2. Freeze the smallest shared interface and transfer it explicitly to consumers.
3. Implement independent files in parallel. The coordinator owns package dependencies, lockfile, CI wiring, application integration, plan status, and commits.
4. Run focused checks, then serialize integration checks to avoid competing large TypeScript/Cargo runs.
5. Give an agent that did not author a slice its diff for review. Resolve correctness findings and rerun affected checks.
6. Open or update the PR with exact implemented scope, checks, unresolved limits, and follow-up gates. Never turn a local focused pass into an assertion of persisted runtime or full release readiness.

Preserve unrelated working-tree edits. In the initial session, `web/app/(modules)/modules-shell.tsx` already had an unrelated change and is excluded from this PR.

## Delivery sequence and acceptance gates

| Slice | Bounded scope and ownership | Exit evidence |
| --- | --- | --- |
| P1: static Overview presentation | Core agent: `packages/presentation-core/**`; adapter agent: `ui/src/lib/presentation-dashboard*`; coordinator: Overview integration and shared wiring | Serializable definition, deterministic section order and typed data bindings; adapter parity for existing metrics/chart/table; relevant typechecks and existing guards pass; no runtime persistence or admin endpoint introduced |
| P2a: ERP dictionary vertical slice | Contracts lane owns structural descriptors and reviewed domain annotations; harness/API lane owns scoped discovery and typed acquisition; coordinator serializes generation/release | One existing read capability resolves from discovery through authorization to typed results/dataset evidence; schema and semantic provenance are separate; unresolved facts cannot become publishable bindings |
| P2b: complete F0 composition contracts | Inventory list/detail/form/action/report primitives; define versioned module/page/node/slot contracts, component catalog, host and shared validator interfaces | One canonical model per required intent; binding-to-generated-resource/operation inventory and pin compatibility review; no parallel mutable placement model; exact file ownership frozen before parallel implementation |
| P3: F0.5 human module composition | Backend lane owns immutable versions/activation/audit and projection coverage; UI lane owns host/editor and existing-component adapters; proof lane owns fixtures | Create a Collections module/page without source edits, reshape and reopen it; preview/publish/revert; cross-org/personal/team authority tests, concurrent-edit conflicts, stale/disabled dependency recovery, bounded/coalesced reads |
| P3H: harness and sandbox extension proof | Build the minimal WorkProgram runtime/certification subset from its governing plans; harness proposes the same typed module patch used by the editor | After P3 and pinned program/runtime/IO/provenance gates: run a read-only sandbox program explicitly, certify and publish its version, attach its derived report, reopen persisted output, and revert placement; no sandbox execution on page render or direct ERP mutation |
| P4: finish F1 and F2 | One actual workflow (onboarding) and Overview rendered from shared semantics; static ProgramRun input/progress/output fixture | Preserve real bootstrap commands, resume/failure semantics, subscription/cache lifecycle, accessibility and rendering parity; no new mutation retry loops or execution on render |
| P5: F3 Expo proof | Extend the existing mobile app after human/harness module semantics are proven; consume the same published module/page and workflow definitions | Same intent and state fixtures across web/mobile; native layout/navigation remain renderer-owned; no duplicated workflow authority |
| P6: F4/F5 reusable work | Reporting/WorkProgram presentation, then import/document proof; admit only supported capability references | Input/run/output semantics, provenance, manual execution/admission, artifact freshness, shared primitives; render never starts expensive work |
| P7: F6 publishing and placement | WorkProgram versioning and promotion through the proven admin registry | Immutable version references, preview/publish/revert audit, compatibility and authorization checks on every execution |
| P8: F7/F8 retirement | Remove legacy frames only after migrated consumers reach zero; non-React renderer fixture | Interaction parity and owner handoff, zero retired consumers, renderer independence without building a production GPUI client |

P1's existing web adapter is an enabling component for P3; it does not authorize dynamic publishing. P2a and P2b may have parallel audits, but their generated bindings and publication interfaces are integrated sequentially. P3 precedes P3H and all AI-created placement. P3H advances one read-only WorkProgram/report vertical slice ahead of broad F4/F5 convergence; it cannot bypass the runtime/certification prerequisites. P4 still owns full workflow/onboarding proof. P2a–P8 are pending until their own evidence is recorded.

**P3H runtime-readiness gate:** Before the harness extension proof, demonstrate a concrete deployed `SandboxProvider` and pinned runtime profile, authorization-scoped dataset handles, typed input/output validation, bounded admission, durable run/event/checkpoint/output records, artifact storage and provenance. Execute a representative program in a disposable real sandbox, reopen its persisted output, and prove failure/cancellation/resume behavior without replaying consequential actions. Existing skill certification workers or fixed certification adapters do not establish a general WorkProgram execution runtime. If this proof is missing, implement the minimal runtime slice from the runtime/sandbox plans first; human module composition can continue independently.

The [WorkProgram convergence plan](./work-program-ui-harness-convergence-plan.md) uses its own WPUI phase names. WPUI2/WPUI3 may exercise static fixtures, but real WorkProgram placement, `Save as reusable tool`, and runtime dashboard bindings must consume the F0.5 registry proof; their phase numbers do not bypass P3. For onboarding, first decide whether the proof covers the existing single bootstrap command or introduces persisted multi-step progression. The direct bootstrap endpoint is a remaining typed-contract gap, not evidence that the planned generated-command workflow already exists. Verify refresh/restart recovery, duplicate-submit handling, error mapping, and pre-tenant identity semantics before claiming a resumable workflow. Preserve the code-only currency bootstrap (`id: 0` for unaffiliated users): the selected code is submitted and the server/reducer resolves currency and tenant placement authority.

P1 parity means preserving `overview-kpis`, `overview-revenue`, and `overview-attention` order; the four metric labels/values/changes/test IDs; revenue series and month categories; attention column order and alignment; empty arrays; translation; and immutable inputs. Existing organization guard, hydration/loading skeleton, data hooks, subscriptions, owner-control actions, and export behavior remain owned by the page. Review their diff for unchanged wiring; fixture tests alone do not establish live loading/error/navigation behavior.

The contract track can run independently of presentation implementation with disjoint ownership:

- **C1: typed reads per domain.** Classify scope, projection, envelope, cursor, cache/invalidation, and codecs. Preserve the `pos-orders` cursor-envelope exclusion until its result contract exists. Use the pinned generated resource set; unsupported resources require a separate contracts change and release gate.
- **C2: redundant-layer retirement.** Inventory callers of `REDUCER_PARAM_STRUCTS`, `encodeReducerCallArgs`, positional compatibility tooling, metadata exports, and generated proxies. Delete one proven unused symbol group per PR; retain supported dev/E2E/compat paths explicitly. Count both production and test/tool consumers.
- **C3: type-debt migration.** Pick one domain at a time, replace opaque contracts with generated types or named boundary types, reduce its baseline, and pass the ratchet. Do not broaden the allowlist to make a slice pass.

Any Rust/IR schema change is integrated by the coordinator after source, generated artifact, provenance, and pinned consumer gates. Presentation-only work does not need a contract release.

## First PR ledger

| Lane | Assignment | State |
| --- | --- | --- |
| Luna contract audit/core | Audit phases 6–8; implement minimal semantic dashboard core | Implemented; coordinator strengthened binding/type tests |
| Luna presentation audit/adapter | Audit F0–F2; implement adapter and parity tests | Implemented; coordinator corrected chart/ID parity and missing-binding handling |
| Luna delivery review | Review dependencies and acceptance scope, then integrated diff | No remaining blocking finding after corrections; unused series-label field removed |
| Coordinator | Integrate Overview, manifests/lockfile/CI, validation, docs, commit and PR | In progress |

Review caught and resolved a bar-to-area chart regression, icon/test-ID changes, a contradictory test assertion, and missing-binding fallback that masked wiring errors. All four metric mappings, chart data keys/color, table alignment, empty arrays, malformed bindings, and input isolation now have focused fixture coverage. The review also corrected obsolete blanket helper deletion and reconciled bootstrap and WPUI dependencies in the follow-up plan.

Validation: core runtime tests 3/3; adapter and existing dashboard-section tests 10/10; opaque-record ratchet (2110 occurrences, down from 2112); immutable-ID browser transport guard; frontend build-cache graph; and final staged whitespace check passed. Live browser/backend E2E and full release gates have not been run locally for this slice.

Follow-up validation update: presentation-core, UI and web package typechecks all passed locally. Draft PR #13 contains the static implementation. The product-direction changes in this plan are architectural work, not evidence that user/harness module composition is implemented.

## Wave 1: dictionary discovery and module draft foundation

The first implementation wave after Overview covers a bounded part of P2a/P2b:

- `crates/presentation-core` owns strict Rust module/page/collection/detail wire models and pure validation. Rust generates Draft 7 JSON Schema; `json-schema-to-typescript` generates the frontend module contract. Static Overview definitions remain a separate existing proof.
- The API exposes authenticated `GET /v1/presentation/capabilities` and `POST /v1/presentation/validate`. Session-derived organization, current placement, resource read permission and field projection apply. The discovery response includes the draft component catalog used by validation.
- The accounting entry dictionary consumes pinned resource descriptors and registry field policy. Reviewed labels, company-input requirements and provenance are recorded separately. Field bindings explicitly use SQL column names; no generated DTO mapping is inferred.
- Validation rejects incompatible pins, unknown fields, unsupported component kinds/slots, duplicate IDs/fields, invalid revisions, unavailable resource fields, oversized drafts and invalid same-page detail references. HTTP bodies are limited to 64 KiB. These limits describe draft acceptance, not an implemented query executor.
- CI checks Rust/schema drift, schema/TypeScript drift, validator tests and dictionary policy tests. The coordinator owns Cargo/pnpm locks, routes, generated files and review integration; all implementation/review lanes use Luna.

**Activation status:** draft diagnostics only. `valid: true` grants no persistence, publication, runtime execution or authorization. The component entries describe supported draft intents; a dynamic collection/detail host is not implemented. `baseRevision` syntax does not establish optimistic concurrency. The existing accounting query remains unpaginated by this change.

**Remaining P2 gates:** generated SQL-to-DTO field/type mapping and a bounded typed acquisition proof; the full form/action/report intent inventory and component host; immutable dependency and capability admission rules. P2a/P2b are partial until those gates pass. P3's durable module versions, activation/audit/projection, editor, conflict handling and live isolation proof remain pending. P3H cannot begin execution proof until its sandbox runtime gate passes.

**Validation:** Rust validator tests 13/13 and Rust/schema drift 1/1 passed locally. Frontend presentation-core typecheck and existing tests 3/3, generated TypeScript drift, frozen lockfile installation, and frontend build-cache checks passed. CI scope tests 11/11 passed, including generated frontend contracts triggering the Rust drift gate. Full [CI for implementation commit c69330d99](https://github.com/KevTiv/lumiere-v-1/actions/runs/34698167013) passed, including the API workspace check, presentation contract and discovery-policy tests, frontend, contracts drift, PostgreSQL gates, and compile smoke. The redundant local API build was stopped after this exact-commit CI evidence became available. This validates the foundation increment, not the remaining P2/P3 runtime acceptance gates.

## Resume instruction

Read this ledger and the parent plan, refresh the checkout and pin, choose the next unfulfilled slice, and assign bounded Luna lanes. State its exact gate before editing. Preserve previous accepted work and unrelated edits; update this ledger with tests, remaining blockers, and the next slice. Do not mark the whole frontend IR refactor complete from the static Overview proof.

## Wave 2: authorized collection/detail preview

This increment implements a read-only part of P2a/P2b and the preview portion of P3. Luna lanes own acquisition, generated-schema projection, and the shared collection/detail host; the coordinator owns wire generation, route/composer integration, checks and PR delivery.

- Strict Rust preview request/options/response types generate JSON Schema and TypeScript. The browser validates responses using that schema. Row IDs remain decimal strings; display values are bounded text.
- `GET/POST /v1/presentation/preview` discovers actor-filtered choices and validates the complete draft before acquisition. Session organization, current placement, resource/field policy and membership-derived company scope apply. Up to four collection bindings are admitted; identical resource/company/limit reads share an acquisition. Linked detail fields are included in each node's authorized projection.
- The acquisition uses supported SQL `LIMIT n + 1` (maximum 101 rows), verifies returned organization/company/IDs, and exposes `truncated`. It is a bounded sample, not ordered pagination. The pinned SQL parser rejects `ORDER BY`; see the [SQL reference](https://spacetimedb.com/docs/reference/sql/). Sorting the bounded sample does not establish global order or a continuation cursor.
- Projection consumes the pinned generated schema manifest and the existing STDB transport's SQL-column-to-JSON mapping. No companion contract release or handwritten frontend DTO mapping is introduced. Individual values are capped at 4096 characters and total displayed values at 1 MiB.
- `/presentation-preview` lets an authenticated user choose collection/detail fields, title and sample limit for the active company's accounting entries. The shared host supports collection selection, linked detail, multiple pages, loading/error/empty/missing data states and truncation. Company changes abort requests and remount state; edited definitions hide stale results.
- CI now runs all API presentation tests, including HTTP/SATS acquisition fixtures for membership, tenant predicates, limit and rejected company intent.

**Validation:** canonical Rust validator 13/13 and schema drift 2/2 passed; frontend core runtime/decoder tests 5/5 and typecheck passed; collection/detail host tests 5/5 passed; API presentation tests 17/17 passed locally, including HTTP/SATS membership and acquisition fixtures. UI/web typechecks, full Rust-to-schema-to-TypeScript drift, opaque-record ratchet, immutable browser transport and build-cache graph passed. The initial CI compiler finding was corrected in `56a0d981a`. [CI for that implementation commit](https://github.com/KevTiv/lumiere-v-1/actions/runs/34700643191) passed all jobs, including Rust, Frontend, SpacetimeDB, contracts drift and compile smoke. The transport tests use a local mock STDB server; a deployed database/browser interaction proof has not been run.

**Remaining gates:** ordered pagination needs a supported indexed read contract; the full form/action/report inventory remains pending. P3 still needs durable immutable module versions, reopen/edit conflict handling, publish/revert authorization and audit/projection, and live isolation proof. The current human composer changes a read-only preview, not a saved module. P3H sandbox execution and certification remain gated on those persistence and runtime foundations. Next milestone: canonical persisted module draft/version ownership and its authorized read/write API, followed by the editor save/reopen proof.

### Wave 3 handoff: saved module ownership

The next wave requires a dedicated canonical module/version resource. `spacetimedb/src/workflow/definitions.rs` provides an existing expected-revision lifecycle precedent; it is not a reusable module store. `dashboards`/`dashboard-widgets` remain mutable report configuration and do not establish immutable module publication.

Freeze the module owner/scope, immutable version payload, expected-revision conflict rule and generated contract before parallel implementation. The contracts lane owns STDB resources/reducers and projection/reconstruction coverage; the coordinator serializes generator/release/pin gates. The API lane then reuses `trusted_context.rs` and the presentation catalog for scoped save/read validation. The UI lane adds save/reopen to the existing composer only after that contract is available. Acceptance requires persisted round-trip, stale revision rejection and cross-organization denial. Publication/activation and sandbox execution remain separate subsequent gates.
