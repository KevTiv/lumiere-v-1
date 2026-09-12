# Remaining frontend IR work — Luna coordination and delivery

**Status:** First implementation slice in progress — 2026-09-12
**Baseline:** `06c9c82a00e8cdaf9a07f2363786b6d5f043a88f` on `main`; application contracts pinned to v0.3.40.
**Parent:** [Frontend multi-surface architecture](./frontend-multisurface-workflow-presentation-plan.md)
**Related:** [Typed BFF SDK](./typed-bff-sdk-contract-hardening-execution-plan.md), [Overview](./overview-dashboard-subagent-plan.md), [Onboarding](./organization-onboarding-workflow-subagent-plan.md)

## Outcome and current scope

Deliver the remaining contract and presentation work as small reviewed PRs with independently recorded gates. The first PR extracts a static, serializable Overview dashboard definition into a renderer-neutral package and adapts it to the existing web dashboard. It also reconciles the remaining roadmap against the current code.

This first slice is partial F0/F1 work. It does not complete F0's full model inventory, the F0.5 admin publishing proof, F1's workflow/WorkProgram proof, or the F2 paired web/mobile proof. Static developer-authored presentation data must not be exposed as an unvalidated runtime admin configuration endpoint.

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
| P2: complete F0 contracts | Inventory existing list/detail/form/action/report primitives; define only models with immediate consumers, workflow state provenance, approved references, token boundary, and runtime persistence ownership | One canonical model per required intent; binding-to-generated-resource/operation inventory and pin compatibility review; model review records reuse vs new ownership; no duplicate authorization or transport policy |
| P3: F0.5 admin registry | One approved Overview placement; backend agent owns version/publish/revert persistence and authorization, UI agent owns editor, proof agent owns negative fixtures | Immutable published versions, current actor/org checks, audit and rollback, referenced-contract validation, cross-org rejection, disabled/invalid entries fail closed, renderer-neutral fixture |
| P4: finish F1 and F2 | One actual workflow (onboarding) and Overview rendered from shared semantics; static ProgramRun input/progress/output fixture | Preserve real bootstrap commands, resume/failure semantics, subscription/cache lifecycle, accessibility and rendering parity; no new mutation retry loops or execution on render |
| P5: F3 Expo proof | Extend the existing mobile app with the same Overview/onboarding definitions | Same intent and state fixtures across web/mobile; native layout/navigation remain renderer-owned; no duplicated workflow authority |
| P6: F4/F5 reusable work | Reporting/WorkProgram presentation, then import/document proof; admit only supported capability references | Input/run/output semantics, provenance, manual execution/admission, artifact freshness, shared primitives; render never starts expensive work |
| P7: F6 publishing and placement | WorkProgram versioning and promotion through the proven admin registry | Immutable version references, preview/publish/revert audit, compatibility and authorization checks on every execution |
| P8: F7/F8 retirement | Remove legacy frames only after migrated consumers reach zero; non-React renderer fixture | Interaction parity and owner handoff, zero retired consumers, renderer independence without building a production GPUI client |

P1's existing web adapter is an enabling component for P3; it does not authorize dynamic publishing. P3 precedes AI-created placement. P2–P8 are pending until their own evidence is recorded.

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

Validation: core runtime tests 3/3; adapter and existing dashboard-section tests 10/10; opaque-record ratchet (2110 occurrences, down from 2112); immutable-ID browser transport guard; frontend build-cache graph; and whitespace check passed. Package typechecks and final staged checks are in progress. Live browser/backend E2E and full release gates have not been run for this slice.

## Resume instruction

Read this ledger and the parent plan, refresh the checkout and pin, choose the next unfulfilled slice, and assign bounded Luna lanes. State its exact gate before editing. Preserve previous accepted work and unrelated edits; update this ledger with tests, remaining blockers, and the next slice. Do not mark the whole frontend IR refactor complete from the static Overview proof.
