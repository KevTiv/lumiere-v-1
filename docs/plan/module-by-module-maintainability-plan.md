# Module-by-module maintainability execution plan

Status: **READY TO EXECUTE — no module is accepted by this document.**
Created: 2026-09-06.
Audience: one maintainer and one implementation agent per session.
Unit of delivery: one coherent, behavior-preserving cleanup slice in one module.

## 1. Run this plan

Paste this into a new agent session, changing the module name:

```text
Execute docs/plan/module-by-module-maintainability-plan.md for module accounting.
Read the module ledger at docs/plan/module-cleanup/accounting.md if it exists;
otherwise create it from TEMPLATE.md in that directory after inspecting the tree.

Refresh the current source, working-tree state, existing ownership decisions,
and validation commands. Select the highest-value unblocked cleanup slice.
Implement it, migrate its in-scope callers, run the appropriate checks, and
update the ledger with evidence and the exact next slice for another session.
Do not stop at an audit if a bounded implementation is possible.

Preserve business behavior, public contracts, authorization, transaction/fence
ownership, checksum semantics, and unrelated work. Use existing shared owners.
Do not build the future generated-UI runtime as part of this cleanup.
Do not commit, push, publish, or deploy unless this session authorizes it.
Use one agent unless I explicitly request delegation.
```

For later sessions, the same prompt resumes the same ledger. An optional focus
can narrow selection, for example `focus: bank reconciliation UI`,
`focus: stock picking orchestration`, or `focus: typed form adapters`.
Module names are logical ownership areas, not assumed directory names. Resolve
the actual paths first. Shared runtime work can use a separate ledger such as
`projection-runtime.md`; do not hide it inside an unrelated business module.

## 2. Purpose and relationship to existing plans

Make a business change understandable and local enough for a solo maintainer to
review confidently. Establish trusted, typed UI pieces before runtime workflows
and LLM-generated presentation definitions compose them.

This document owns **session sequencing, module evidence, and cleanup acceptance**.
It does not supersede the following owners:

| Existing owner | How to use it here |
| --- | --- |
| [Code ownership and deduplication](code-ownership-deduplication-refactor-plan.md) | Reuse its destination map and D-task decisions; reference existing work instead of assigning a duplicate implementation. |
| [Corrective integration evidence](code-ownership-luna-integration-log.md) | Refresh historical accepted/partial work and remaining adoption gaps. |
| [API modularization](api-server-modularization-coordination-plan.md) | Preserve its API destination map; avoid a competing layout. |
| [Opaque-record migration](../plans/frontend-opaque-record-contract-migration-plan.md) | Reuse canonical types, boundary policy, and the existing debt ratchet. |
| [C0–C11 deployability](../plans/core-vertical-deployability-pruning-plan.md) | Retains correctness, durability, isolation, release, and operability gates. Cleanup completion is a separate status. |
| [Multisurface presentation](../plans/frontend-multisurface-workflow-presentation-plan.md) | Owns presentation architecture and the human/admin composition proof before AI composition. |
| [WorkProgram/UI/harness convergence](../plans/work-program-ui-harness-convergence-plan.md) | Owns future versioned runtime extensions and activation; cleanup prepares existing owners for this work. |

Use the smallest useful documentation footprint: this guide, one ledger per
active module, and existing test/code evidence. Do not generate a new report,
framework, or global inventory for every session.

## 3. Findings to investigate, not assumptions to copy

The 2026-09-06 inspection found large accounting/inventory client components,
repeated enum/timestamp conversion, generic records reaching feature logic,
large Rust workflow functions, and repeated projector failure bookkeeping.
Those findings select candidates; line counts and paths can change. Reproduce
only the measurements relevant to the selected slice.

| Signal | Look for | Useful correction |
| --- | --- | --- |
| Oversized controller | One component owns unrelated queries, forms, dialogs, effects, and calculations | Extract a cohesive feature that owns its state and behavior; keep module composition readable. |
| Weak domain types | Generated rows widened to opaque records, then cast repeatedly | Preserve generated row/input types; decode unknown values at an explicit boundary. |
| Duplicate decisions | Multiple implementations of the same ID, enum, timestamp, patch, or error semantics | Compare semantics, select the existing owner, migrate callers, and remove superseded logic. |
| Defensive clutter | Identical conditional branches, permissive fallbacks, repeated shape probing | Use a validated representation and straightforward control flow. |
| Oversized reducer | Validation, planning, mutation, and related workflow consequences interleaved | Introduce named internal stages while retaining one reducer transaction. |
| Error plumbing | Every branch repeats reporting and failure-of-reporting logic | Return typed stage/context information to one reporting boundary, preserving error categories. |
| Unnecessary indirection | A wrapper, interface, factory, or option adds no meaningful boundary | Remove only after checking callers, alternatives, tests, and public compatibility. |
| Test mirroring | Tests assert private layout or source spelling when the contract is behavior | Test observable outcomes and semantic edge cases; retain intentional codegen/drift checks. |

File/function length is a review trigger, not a correctness verdict. Separate
runtime logic from generated artifacts, fixtures, declarative configuration,
and colocated tests. Do not call code dead from a warning or a text search alone.

## 4. Invariants for every slice

1. Organization/actor context remains server-derived; company selection is
   validated. UI permission presentation does not replace server enforcement.
2. Preserve canonical generated params, rows, operations, and codecs. Do not
   create handwritten shadow DTOs or use `as unknown as T` to hide type debt.
3. Preserve missing/null/empty/false/zero distinctions, patch clear versus
   preserve, timestamp units, u64 precision, currency semantics, enum encoding,
   field filtering, and business defaults.
4. Keep one mutation transaction owner, one projection commit owner, and one
   reconstruction fence owner. Extraction must not change side-effect order,
   idempotency, checksum bytes, tombstones, receipts, or rollback behavior.
5. Preserve URLs, exported compatibility paths, query keys, invalidation,
   subscription scope, and handled-empty versus unrecognized dispatch unless
   an explicitly scoped behavior change requires otherwise.
6. Preserve accessibility, focus, keyboard behavior, loading/error/empty states,
   form state lifetime, and modal reset behavior when splitting UI components.
7. Search existing owners before creating another helper. No catch-all utility
   module, universal normalizer, generic repository layer, or giant context hook
   that merely relocates the original controller.
8. Shared types, real provider interfaces, compatibility re-exports, necessary
   comments, and repeated enforcement at distinct trust boundaries are not
   automatically waste. Preserve valid reasons for them.
9. Keep dependency direction. Root Rust services and the standalone STDB module
   are separate build surfaces. Do not introduce cycles to remove a small copy.
10. Do not weaken tests, increase type-debt allowances, edit generated output by
    hand, or change unrelated formatting to make a cleanup appear complete.

Correctness defects discovered during inspection must be recorded distinctly.
If a fix is necessary for the slice and within the user's authorization, implement
and test it as an explicit behavior change; do not disguise it as extraction.
Otherwise select an independent slice and leave an actionable finding.

## 5. Session loop

### S0 — Refresh and choose

- Read applicable AGENTS.md, this guide, the module ledger, and only relevant
  sections of the owner plans. Preserve any current working-tree changes.
- Record branch/HEAD and pre-existing changes in the selected paths. Historical
  counts, acceptance labels, or test reports are not today's baseline.
- Trace one representative user action through component, hook/adapter, API,
  operation/reducer, and applicable persistence/realtime effects.
- List the three most useful cleanup candidates with source evidence. Choose
  one based on maintenance burden, change frequency, and validation feasibility.
- Record exact owned files, in-scope callers, invariants, and expected checks
  before editing. A normal slice covers one feature, one conversion family, or
  one orchestration path. Roughly 3–8 handwritten files is a useful planning
  budget, not a reason to leave required caller migration unfinished.

If shared ownership, a contract change, or unavailable validation prevents the
selected slice, record the dependency and choose another useful slice where
possible. Do not repeatedly rediscover the same blockage in later sessions.

### S1 — Establish the baseline

- Read implementations and call sites, not just declarations or matching names.
- Capture focused measurements: orchestration span, state ownership, duplicate
  implementations, opaque-type debt, or number of hand-maintained contract sites.
  Record how measured and what was excluded; use the same method afterward.
- Run the relevant existing checks before changes when necessary to distinguish
  existing failures. Inspect tests for conditional early returns and live-service
  requirements. A passing no-op test is not persisted-runtime evidence.
- Add a focused characterization test only for meaningful unprotected behavior
  that the refactor could alter. Do not add tests that merely mirror extraction.

### S2 — Implement one complete slice

- Prefer local feature ownership before shared abstraction. Share only when
  current callers demonstrate the same semantics.
- Migrate all callers named in the slice. Search for surviving copies afterward.
  A new utility with unchanged duplicate production implementations is partial.
- Keep the entry point readable as a business sequence. Helpers should name
  decisions or stages, not generic steps such as `process_data` or `handle_stuff`.
- If an extraction requires passing nearly every parent variable, revisit the
  ownership boundary rather than packaging those variables into a bag.
- Avoid coupling stylistic cleanup with performance scheduling, schema migration,
  or new feature work. Record those as separate slices with separate evidence.

### S3 — Verify and review

- Run checks selected by the changed behavior and its consumers (section 7).
- Inspect the final diff for lost checks, changed defaults, side-effect order,
  over-broad exports, accidental generated changes, and unrelated edits.
- Compare the focused baseline and state what became easier to understand.
  Net lines removed alone is not an acceptance criterion.
- Check the module's representative workflow when state/effect/render boundaries
  changed. Compilation alone does not prove interaction or persistence parity.

### S4 — Leave a resumable result

- Update the module ledger with exact files, commands, outcomes, behavior changes,
  remaining copies, accepted exceptions, and the next bounded slice.
- Report changed but unverified work as partial. Mark a stage complete only when
  its evidence covers its declared scope, not because one sample now looks clean.
- End the session after the selected slice is integrated and checked. Do not
  automatically expand into another module or chase unrelated baseline failures.

## 6. Stages to track per module

Stages may require several sessions. Record justified `not applicable` entries
for modules without UI or another surface; do not create code to satisfy a box.

| Stage | Deliverable | Exit evidence |
| --- | --- | --- |
| M0 — Map ownership | Actual entry points, representative workflow, shared dependencies, ranked debt | Ledger identifies where each relevant decision belongs and the first slice. |
| M1 — Clarify contracts | Typed domain inputs/outputs; explicit dynamic-form and external-data boundaries | In-scope opaque domain contracts removed; patch/wire semantics preserved; existing ratchets pass. |
| M2 — Consolidate decisions | One appropriate owner per selected conversion/validation family | In-scope caller adoption and duplicate-removal searches; semantic parity checks. |
| M3 — Decompose UI | Feature-local state, query/action wiring, forms/dialogs, and readable module composition | Representative interaction proof; no giant replacement hook or prop bag; generated contracts retained. |
| M4 — Clarify backend workflows | Named validation/planning/application stages with typed outcomes | Transaction, authorization, error, ordering, and relevant persisted-data checks. |
| M5 — Human composition proof | A real workflow assembled from existing typed UI pieces, with an inspectable data/action map | A maintainer can identify reads, writes, authority, failure behavior, and the feature boundary without tracing a giant controller. |
| M6 — Close the module pass | Remaining findings prioritized; meaningful regression checks and current handoff | Applicable stages accepted, no undisclosed copies/blockers, and remaining exceptions recorded. |

M5 is a cleanup-foundation gate. Start with ordinary checked-in composition;
use an existing admin-composition path if implemented. Building a new runtime
registry is not required here. Prove a second real workflow before promoting
feature pieces into a broader shared vocabulary.

Before future LLM-generated UI **activation**, the presentation/harness plans
must additionally prove definition validation, approved capability/component
references, fresh server authorization, version compatibility, preview, explicit
activation, and rollback. Generated executable code follows a separate reviewed
code-artifact path. M5/M6 do not certify that runtime or mark C8/C9 complete.

## 7. Validation by changed surface

Refresh scripts and prerequisites in the current tree. Examples below exist at
authoring time; replace `<test-filter>` with an inspected test name. Do not run
every row for a local change or treat a root command as covering every consumer.

| Change | Minimum useful validation |
| --- | --- |
| Pure frontend adapter | Focused existing Node/tsx tests; package typecheck and affected consumer typecheck; meaningful malformed/clear/preserve cases when changed. |
| Query/command wiring | Query-hook tests, affected web typecheck, `pnpm -C frontend operation-transport:check`, invalidation/scope behavior. |
| UI feature extraction | UI tests where present, web typecheck, and focused browser workflow including reopen/reset, loading/error, and one successful action with fresh readback where applicable. |
| Root service Rust | `cargo check --locked -p api-server --all-targets` or the affected package; `cargo test --locked -p api-server --lib <test-filter>` or its package equivalent. |
| STDB reducer/helper | Inspect the standalone manifest and Make targets; compile the correct WASM/test surface and execute affected registered reducer tests in a disposable module for changed business behavior. |
| Projection/recovery | Focused pure tests plus the existing real PG/STDB drill when transaction, checksum, retry, watermark, or fence behavior could change. |
| IR/generated contract ownership | Existing codegen, contract, Rust, TypeScript, package, and release compatibility checks required by the canonical owner plans. |

Useful existing frontend commands:

```sh
pnpm -C frontend --filter @lumiere/erp-shared typecheck
pnpm -C frontend --filter @lumiere/query-hooks typecheck
pnpm -C frontend --filter @lumiere/ui typecheck
pnpm -C frontend/web typecheck
pnpm -C frontend type-debt:check
```

The opaque-record ratchet also requires recording reductions. Run
`pnpm -C frontend type-debt:check -- --write-baseline` only after reviewing the
delta; accept only reductions/removals attributable to this slice. Never use a
baseline rewrite to admit new debt or unrelated changes. Boundary exemptions
need the existing policy's documented rationale.

`make check-codegen` invokes generation and can modify staging. Serialize it
with other generated/Cargo integration work. Review resulting diffs. A passing
local generation check is not an immutable contract release.

Inspect Make recipes before running them: `make test` currently includes
`publish-clear`. Never point destructive test setup at an existing shared or
production database. Use the repository's disposable test workflow and normal
environment permission mechanisms.

If a check cannot execute, retain its exact reason and scope in the ledger.
Do not weaken it, claim it passed, or treat an unrelated baseline failure as a
new regression. Avoid broad new test infrastructure for a small cleanup.

## 8. Readability acceptance and regression policy

Review the changed path against these questions:

- Does the entry point communicate the business sequence in domain language?
- Can the next maintainer locate each decision's owner without following a chain
  of pass-through wrappers or reading an unrelated feature?
- Are inputs, outcomes, nullable states, and side effects explicit?
- Did extraction reduce shared mutable state and knowledge between features?
- Have replaced copies actually disappeared from the in-scope production path?
- Do comments explain constraints and reasons rather than narrate each line?
- Would the tests fail for a plausible behavioral regression?

Use the existing type-debt and contract ratchets now. For function length,
complexity, and duplication, record focused before/after evidence first. If
automating later, reuse established analyzers and baseline existing debt;
fail only meaningful regressions in changed code, with reviewed exceptions for
generated/configuration/fixture code. These extra analyzers are **not implemented
by this document**. Do not move opaque records into aliases, move a giant body
unchanged into a hook, or add suppression to manufacture an improved score.

## 9. Suggested module order and shared work

Start with accounting, then inventory; both have observed controller/type debt
and exercise useful forms, tables, actions, and workflow boundaries. Continue
with sales and purchasing to check the abstractions against connected workflows.
After that, choose modules by active development and measured maintenance cost:
CRM, expenses, HR, projects, manufacturing, subscriptions, and the remaining
enabled modules. No module is pre-classified as clean or complete.

Forms/workflow and AI/harness deserve their own ledger when their shared runtime
is changed. Keep service-level projection/recovery/error cleanup independently
owned. A business-module session may record a shared prerequisite but must not
quietly redesign it for every consumer.

Discover the current enabled set from the actual STDB module declarations and
frontend routes/packages. Include seed, core, data operations, or integration
surfaces when they own the selected behavior; avoid a stale fixed module count.

## 10. Completion and handoff

Use [the ledger template](module-cleanup/TEMPLATE.md). Copy it once per active
module, fill real evidence, and retain a compact session history in that file.

`Module cleanup accepted` means the declared module scope has been reviewed,
its applicable stages passed, and any residual debt has an explicit rationale.
It does not mean zero debt, production readiness, performance certification,
or permission to activate generated UI. A completed slice must not promote the
whole module when other owned features remain unreviewed.

Final session response: what changed and why; exact validation scope; remaining
limitations; ledger link and next slice. Include commit/release identity only
when those actions actually occurred under session authorization.

## 11. External rationale

These sources motivate inspection criteria; they do not establish AI authorship
or a numerical quality score for this repository:

- [Google code-review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html): understandable design, necessary complexity, meaningful tests, and comments explaining decisions.
- [Birgitta Böckeler: maintainability sensors](https://www.martinfowler.com/articles/sensors-for-coding-agents.html): function/argument complexity and change coupling as practical signals, with contextual review of legitimate architecture.
- [GitClear 2025 report](https://gitclear-public.s3.us-west-2.amazonaws.com/GitClear-AI-Copilot-Code-Quality-2025.pdf): observational duplication/refactoring trends; not causal proof about this codebase.

