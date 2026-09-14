# ERP harness implementation: coordinated delivery program

**Status:** PROPOSED EXECUTION AUTHORITY — revised 2026-09-14  
**Scope:** remaining Lumière ERP + AI harness convergence after the v0.3.46 capability foundation  
**Execution owner:** primary implementation session acting as coordinator  
**Roadmap ledger:** [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md)  
**Mandatory cohesion plan:** [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md)  
**Cohesion ledger:** [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md)  
**T0 ERP parity plan:** [`../plans/erp-module-usability-parity-program.md`](../plans/erp-module-usability-parity-program.md)  
**T0 ERP parity ledger:** [`erp-module-usability-parity-ledger.md`](./erp-module-usability-parity-ledger.md)  
**Worker handoff:** [`erp-harness-implementation-handoff.md`](./erp-harness-implementation-handoff.md)

This document does not replace architectural plans in `docs/plans`. Those remain semantic/invariant specifications. This document owns **implementation sequencing, work-package boundaries, coordination, evidence, and promotion gates**.

## 1. Why this program exists

Lumière now has strong architecture plans across application-contract IR/codegen, governed agent execution, ERP workflows, adversarial invariants, module cleanup, evidence/recovery, WorkPrograms, sandbox execution, security/residency, learning/forensics, and optional model refinement.

Those plans are too broad to hand directly to implementation workers. The execution model is:

```text
semantic architecture
      ↓
bounded task card
      ↓
one responsibility + one owner
explicit prerequisites + forbidden scope
focused validation
      ↓
coordinator review/integration
      ↓
evidence-backed acceptance
      ↓
promotion gate
```

A task should normally fit one focused Luna session. `2x`/`3x` parent packages authorize multiple bounded child slices, not one oversized diff.

The product also needs a distinction the earlier roadmap did not make strongly enough:

- **T0** answers whether the ERP itself is coherent enough for the first test organization;
- **P0/P1** answer whether AI execution is admitted.

The first organization must not depend on AI-harness completion to receive a usable ERP.

## 2. Authority hierarchy

When plans overlap, use this precedence:

1. **Security/business invariants** — HSEC, ADV, current tenant/authorization contracts.
2. **Canonical ERP contract ownership** — application-contract IR, generated capability metadata, reducer/operation history, immutable `lumiere-contracts` releases.
3. **Domain semantics** — ERP workflow integration and domain remediation/gap plans.
4. **T0 module product coverage** — `erp-module-usability-parity-program.md` decides whether a module/surface is complete enough to expose to the first test organization.
5. **Harness semantics** — AI harness completion, enterprise harness, unified execution/capabilities.
6. **Reusable execution** — WorkProgram/sandbox/workspace/certification/security plans.
7. **Learning/forensics/model refinement** — HLEARN, INTRO, MLEARN.
8. **Repository cohesion plan** — resolves conflicts between multiple implementation generations of the same concern; it does not override semantic invariants above.
9. **This coordination document** — sequencing and ownership only.

`module-by-module-maintainability-plan.md` owns readability/ownership cleanup. Its acceptance never implies T0 usability certification.

If semantic plans materially conflict after applying this hierarchy, stop and return the conflict to the coordinator. Workers do not invent a third architecture.

## 3. Starting implementation state

Recheck through `BASE-00`, `COH-00`, and `COV-00`; this is orientation, not acceptance evidence.

The recent harness stack has already introduced substantial foundations: typed provider tool transport, generated/authorized tool registry seams, a bounded recorded loop, per-call policy checks, spend reservation/settlement, provider attempts with `outcome_unknown`, durable run wait states, non-progress detection, generated capability artifact v2, and first reviewed inventory read descriptors.

A focused implementation pass also found parallel generations still alive:

```text
legacy skill executor          + governed executor
legacy budget/spend            + reservation/attempt/settlement
latest-row draft lookup        + request-correlated creation
multiple action implication maps
compiled policy reconstruction + immutable released manifests
handwritten resource contracts + generated application IR
inconsistent company-scope semantics
request security fields        + planned trusted context
payload-ish step logs          + planned semantic evidence
opaque internal/string errors  + desired typed outcomes
```

Those seams are mandatory COH work before broad production capability expansion.

The ERP has a separate completeness problem. Backend operations and named command contracts cover many modules, and the current frontend route tree is broader than older frontend plans, but coverage is uneven. Routes, reducers, hooks, or CRUD forms do not establish complete workflows. `COV-00` must re-audit the actual current tree and classify every test-org surface before implementation.

The pre-tenant adversarial work also found confirmed business defects in communication/payment/import/recovery paths. Those remain blockers for affected T0/P0 capabilities until repaired and re-run.

## 4. Sequencing spine

After the accepted BASE/COH foundation, ERP product readiness and AI admission become parallel lanes:

```text
BASE — accepted implementation + known defects
   ↓
COH — one authority / meaningful outcomes / seam eradication
   ├─────────────────────────────────────┐
   ↓                                     ↓
ERP-COV — module/workflow parity         GOV — governed AI activation
   ↓                                     ↓
T0 — first-test-org ERP ready            P0 — governed read-only AI pilot
   │                                     ↓
   │                                     TRACE/CAP
   │                                     ↓
   │                                     P1 single-agent production harness
   └──────── certified ERP workflows ────┤
                                         ↓
                              WPR reusable WorkProgram runtime
                                         ↓
                              SBX sandbox/data/artifacts/workspace
                                         ↓
                              SEC enabled-profile certification
                                         ↓
                              P2 reusable new-generation ERP execution
                                         ↓
                              LEARN + INTRO → P3
                                    ↙             ↘
                                ADVAI/P4        MLEARN/P5
```

This is dependency-driven, not strictly serial:

- `BASE-03/04` business-defect remediation runs in parallel with COH;
- `COV-00` may run alongside COH census work because it inventories product completeness rather than authority seams;
- security trusted-context/envelope work starts with COH and converges on one type/lineage;
- ERP module completion/ADV certification proceeds independently of AI plumbing;
- contract producers may work in parallel when the single release lane is free;
- COV module lanes run concurrently when they do not share domain/schema/UI owners;
- later schema design may begin early, but promotion gates cannot close before prerequisites.

## 5. Promotion targets

### Foundation gate — cohesive implementation

Before new production AI capability admission, relevant COH gates require one authority for identity, scope, capability, released policy, ERP structure, execution, spend and effect correlation; typed expected outcomes/errors; exact/reconcilable consequential effects; no ignored critical persistence/spend/audit failure; explicit compatibility deletion gates; generated structural contracts; and immutable released policy. Detailed acceptance is `COH-12`.

### T0 — first-test-organization ERP readiness

T0 is the minimum product gate for exposing the ERP to the first test organization.

Required:

- `COV-00` current module/operation census accepted;
- every module/surface visible to the test organization is **U5 first-test-org certified** under the parity program;
- non-U5/internal/developer surfaces are hidden or explicitly disabled;
- every exposed module has discoverable records, complete primary lifecycle, canonical result readback and direct cross-module links;
- expected errors/outcomes use the common COH semantics on migrated boundaries;
- approval, stale-state, retry, idempotency, committed-response-lost and tenant behavior are explicit where applicable;
- horizontal documents/activity/messages/approvals/audit/report/import capabilities are integrated rather than copied per module;
- one reproducible seeded organization/persona pack supports all module E2E tests;
- no exposed stub route, empty promised tab, dead quick action, fake local success, or accidentally orphaned test-org operation remains;
- module golden-path Playwright and applicable adversarial tests actually run;
- Order-to-Cash, Procure-to-Pay and other enabled cross-module verticals satisfy their deeper INT/ADV gates;
- representative refresh/reconnect and responsive/mobile checks pass.

T0 does **not** require exposing every reducer. Every user-facing operation must instead be classified as primary-workflow, secondary-advanced, horizontal, internal-support, future-disabled, or obsolete/duplicate.

### P0 — governed read-only AI pilot

Required:

- cohesive foundation accepted for relevant paths;
- one production route reaches the canonical governed loop;
- current actor/company authorization narrows reviewed generated tools;
- spend/provider-attempt lifecycle is active;
- candidate answers pass admitted answer validation;
- direct mutation is unreachable;
- run/provider ambiguity is inspectable/reconcilable;
- read-only authority/tenancy/fallback E2E passes.

P0 may run in the first test organization only when its visible AI surface is itself stable; P0 does not substitute for T0 ERP readiness.

### P1 — single-agent production harness

Required: P0; base interactive/recovery/evidence semantics equivalent to AIH M0–M7; one production skill execution authority; admitted generated/scoped capabilities; consequential ERP capabilities limited to T0/INT/ADV-certified workflows; current-policy/action-draft invariants; and operator run/evidence/recovery surfaces. M8/M9 may remain disabled.

### P2 — reusable new-generation ERP execution

Required: P1; immutable WorkProgram compiler/runtime; durable ProgramRun/checkpoint/resume; simulate/dry-run/preview/live modes; sandbox dataset/evidence/artifact boundary; approved runtime profiles + Lumière SDK; certification/compatibility/dependency graph; shared ProgramRun UI; and HSEC/supply-chain gates for every enabled profile.

### P3 — learning + forensic production plane

Required: P2 plus observable decision/correction/replay/comparison, ExperienceCases, governed organization learning, causal introspection/index/API/UI/export, and retention/legal-hold/integrity.

### P4 — optional advanced execution

Separately admitted bounded specialists and typed lifecycle extensions.

### P5 — model-refinement plane

Separately admitted training permissions, ExperienceCase compiler, immutable datasets/benchmarks, capability ranker/later task models, model registry/shadow/canary and optional adapters. Production traces are never trainable by default.

## 6. Non-negotiable implementation invariants

Every task preserves:

1. STDB owns business state and canonical transitions.
2. Current server/Casbin policy owns ERP permission.
3. Generated application contracts own ERP structural capability semantics.
4. Immutable released skill/program manifests own admitted execution policy.
5. Browser/model input never grants org/company/role/capability/region/processor/credential/path/reducer/SQL authority.
6. Child execution only narrows parent authority.
7. Agent configuration narrows; it does not become permission authority.
8. Consequential AI effects are draft/approval/certified-capability effects, not direct model mutation.
9. Consequential creates use exact correlation/idempotency; “latest row” is not effect identity.
10. `outcome_unknown` is distinct from failure and has reconciliation ownership.
11. Critical ledger/audit/spend/effect errors are never silently ignored.
12. Generated artifacts are not hand-edited; immutable releases are not rewritten.
13. Sandbox code receives no standing ERP/PG/object-store/provider credentials.
14. Provider/sandbox fallback never weakens scope/residency/retention/training/disclosure policy.
15. Durable authority, effects, approvals, budgets and checkpoints are not reconstructed from model prose.
16. Hidden model reasoning is not persisted.
17. Rejected operations leave zero unauthorized/partial business delta.
18. AI failure never blocks ordinary ERP operation.
19. Unit tests alone do not close an integration/promotion gate.
20. A route/reducer/hook/CRUD screen alone is not module completion; exposed T0 modules require complete primary workflows.
21. A non-U5 feature may remain in code, but must not be accidentally exposed to the first test organization.
22. Cross-module workflow code composes canonical domain operations; it never becomes a frontend business-rule engine.

## 7. Meaningful code and outcome ownership

A cohesive path should read:

```text
thin transport adapter
→ trusted context + typed intent
→ application service/workflow/executor
→ generated/domain capability
→ infrastructure adapter
→ typed outcome/error
→ one transport mapper
→ canonical readback / direct record ref
```

Expected consequential outcomes are semantically:

```text
Applied
AlreadyApplied / NoOpReplay
Rejected
Waiting
OutcomeUnknown(reconciliation ref)
```

Expected failures preserve stable classes such as invalid input, forbidden, stale/conflict, precondition, rate/budget, dependency unavailable, timeout and outcome unknown until the API/UI boundary. Do not solve this with a giant global error enum.

## 8. Coordinator operating contract

The coordinator owns integration, not only delegation.

Responsibilities:

- start from latest **accepted** revision;
- inspect current code/open PRs/contracts/known failures before assignment;
- reconcile historical work through `BASE-00`;
- run `COH-00` before broad production capability expansion;
- run `COV-00` before module-completeness estimates or broad ERP assignment;
- maintain the main, COH and COV ledgers and accepted dependency graph;
- reserve shared integration surfaces and one contract/release lane;
- review actual diffs and surrounding code;
- inspect authority, retry/idempotency, stale-state, error/outcome and effect certainty;
- for COV work, verify user reachability, lifecycle completeness, canonical readback, direct record links and no visible stubs;
- run integrated/adversarial validation after batches;
- stop dependent work when prerequisites are not accepted;
- record blockers rather than converting missing evidence into passes.

With four slots:

```text
primary coordinator: integration/review/release lane
worker A: runtime/backend or one bounded module slice
worker B: independent domain/security/module slice
worker C: frontend/tests/contract-producer or independent module slice
```

## 9. Reserved integration surfaces

Coordinator-owned by default unless transferred explicitly:

- root route/navigation registration when multiple modules touch it;
- canonical ERP workflow/result/error/record-ref shared surface;
- canonical AI execution dispatch/trusted-context integration;
- shared tool/harness registry integration;
- shared STDB module/schema wiring;
- Cargo/package manifests/lockfiles;
- generated contract output/staging;
- release manifests and contract pins;
- shared frontend generated/API exports;
- T0 launch/exposure manifest;
- coordination plans/ledgers.

One owner at a time for schema/registry/release/shared workflow surfaces.

## 10. Contract/schema release protocol

Any task changing STDB schema, operation signatures, generated capability metadata, shared schemas or canonical IR splits into:

```text
A producer source change
      ↓
B deterministic codegen + immutable contracts release
      ↓
C consumer pin + runtime/frontend wiring
```

Producer does not hand-edit generated output; consumer does not assume unpublished contracts; one release lane is active at a time; release compatibility gates run before consumers advance; contract expansion outside assignment stops the current task.

## 11. Work-package assignment contract

Every worker receives task ID/objective, promotion target, source-plan sections, base revision/prerequisites, allowed files/schemas, reserved owners, exact deliverables, invariants, forbidden scope, focused validation, integration evidence, release role, and handoff requirements.

COV assignments additionally state:

```text
module/surface
current U-level + evidence
target U-level for the slice
primary workflow/sub-workflow
visible deferrals that must remain hidden
expected resulting-record links
required personas/viewports/E2E cases
```

Workers must not broaden scope; add duplicate registries/policies/executors/workflow owners; disable checks; use latest-row effect discovery; turn outcomes into string parsing; discard critical errors; edit generated output; publish contracts unless assigned; expose incomplete module features; or start another task without assignment.

## 12. Acceptance loop

For every worker return:

1. compare diff to assigned scope;
2. identify canonical owners touched/retired;
3. reject opportunistic redesign and parallel authority;
4. inspect org/company/current-policy derivation;
5. inspect capability narrowing/released-policy use;
6. inspect retry/idempotency/stale/outcome-unknown behavior;
7. inspect typed error/outcome propagation;
8. inspect critical persistence/audit/spend handling;
9. verify generated contracts remain structural truth;
10. for COV work, exercise the feature from the owning UI workflow through durable canonical readback and downstream record links;
11. verify incomplete secondary features remain hidden/disabled;
12. integrate shared wiring after worker ownership ends;
13. run focused tests on the integrated tree;
14. run required adversarial/E2E gate;
15. record revision, reviewer, commands/results, U-level where applicable, compatibility remnants and blockers;
16. unblock dependents only after acceptance.

An isolated green worker branch is evidence, not acceptance.

## 13. Execution lanes

### Lane A — BASE / business correctness
Accepted integration baseline, communication/payment/import/recovery defects and pre-tenant E2E.

### Lane B — COH / authority and outcome convergence
Trusted context, capability authority, immutable release consumption, generated structural contracts, scope consistency, exact effect correlation, one executor/spend path, typed errors/outcomes, semantic events, file boundary and compatibility ratchets.

### Lane C — ERP-COV / first-test-org parity
Module census, shared workflow/result UX, seeded test org, CRM/Sales/Purchasing/Inventory/Manufacturing/Finance/HR/Projects/Expenses/Subscriptions/POS/Helpdesk/Fleet/IoT/Proposals and horizontal Documents/Calendar/Messages/Reports/Approvals/Workflows/Imports/Forms/Templates/Settings/Distributor completion through U5.

### Lane D — ERP/ADV vertical certification
Order-to-Cash, Procure-to-Pay and other human canonical cross-module workflows plus business-invariant certification. This lane and ERP-COV cross-check each other; neither substitutes for the other.

### Lane E — GOV/TRACE
Canonical production loop activation, answer/action gates, questions, repair, continuation, session controls, evidence and knowledge.

### Lane F — CAP/contracts
Generated/scoped capabilities and serialized immutable releases. Consequential exposure waits for certified human workflow semantics.

### Lane G — WPR/SBX
Reusable runtime, sandbox, artifacts, workspace and CLI.

### Lane H — SEC
Authority/residency/retention/sandbox/supply-chain proof. SEC context/envelope work converges with COH rather than creating a sibling type.

### Lane I — LEARN/INTRO
Decision trace, corrections/replay/org learning and forensic causal platform.

### Lane J — ADVAI/MLEARN
Separately admitted specialists/extensions and model refinement.

## 14. System validation matrices

### T0 module parity

For every exposed module:

```text
discovery/navigation
core list/search/detail
create/edit/domain-equivalent operations
primary lifecycle from start to terminal/wait/cancel
direct upstream/downstream record links
allowed actor / denied actor
company/tenant isolation
stale-state conflict
duplicate submission
committed-response-lost / retry semantics
approval / separation of duties where applicable
loading/empty/error/denied UX
refresh/reconnect canonical readback
documents/activity/messages/audit where applicable
responsive/mobile viewport proof
persisted Playwright golden path
applicable ADV/pre-tenant cases
non-U5 deferrals hidden
```

### Canonical AI/program execution

```text
actor allowed / denied
company narrowed
permission revoked mid-run
released policy changed/rolled back
budget exhausted
provider fallback
malformed tool call
non-progress
answer validation failure
interrupt/reconnect/resume
```

### Consequential effects

```text
valid draft/effect
idempotent replay
conflicting request-key replay
stale resource version
unauthorized/self approval
permission revoked after approval
approved content changed after approval
committed-but-response-lost
outcome unknown + reconciliation
cross-tenant reference
```

### Error/outcome contract

Verify invalid input, unauthenticated/forbidden, not found, stale/conflict, precondition, rate/budget, dependency failure, timeout, outcome unknown and internal invariant map to stable code, safe message, correlation ID and correct retry advice. Clients do not parse internal strings.

### Sandbox

Verify no standing secrets, network deny/default, host-path denial, cross-tenant scratch reuse, expired/revoked handles, artifact disclosure limits, resource exhaustion, warm-pool cleanup and brokered external capabilities.

### Residency/retention

Verify allowed region, forbidden fallback, zero-retention/training constraints, artifact/search/vector/sandbox placement, logs/traces classification, delete lifecycle, legal hold and backup/recovery inventory.

## 15. New-generation ERP scope discipline

The harness is not a second ERP architecture. Stable work graduates:

```text
ad-hoc run
→ recipe
→ reviewed skill / WorkProgram
→ repeated broadly useful behavior
→ deterministic generated capability / first-class ERP feature
```

Ownership remains:

- business rules → STDB/domain;
- capability structure → application IR/codegen;
- human workflow composition → typed ERP workflow/application layer;
- reusable AI/program orchestration → WorkProgram;
- presentation → renderer-neutral/shared UI contracts;
- authorization → server/Casbin;
- sandbox → isolated analysis/artifact execution;
- model layers → selection/reasoning patterns, never authority.

Module parity does not justify exposing every reducer. Product surfaces are designed around business workflows, while every operation is classified and intentionally owned.

## 16. Stop rules

Stop and return to coordinator when:

- task requires unassigned schema/contract expansion;
- generated output unexpectedly differs from canonical source;
- two plausible authorities exist for one concern and COH has not resolved them;
- current authorization cannot be derived from trusted server context;
- task needs raw SQL/reducer/path/credential authority not admitted;
- dependent business workflow has not passed its invariant gate;
- fallback would weaken security/residency/privacy/retention/training-use;
- consequential outcome is uncertain without reconciliation;
- expected failure semantics require string parsing/generic 500;
- critical persistence failure would have to be ignored;
- test reveals cross-tenant/partial business mutation;
- worker would need files owned by another active task;
- only path to green is loosening a gate/disabling a check;
- a COV slice would expose a visibly incomplete feature simply to increase coverage;
- a module's primary lifecycle depends on manual database/admin intervention or manually searching downstream records.

## 17. Promotion evidence

Every promotion record includes promotion target, revisions, contracts versions, config/runtime versions, focused tests, E2E/adversarial results, expected skips, security/residency evidence, error/outcome evidence, reviewer, open deferrals and rollback/disable control.

T0 additionally includes:

```text
current module exposure manifest
U0–U5 matrix for every exposed module
seed/test-org revision
personas exercised
module golden-path specs
cross-module INT/ADV evidence
responsive/reconnect evidence
operation classification report
explicit hidden/disabled non-U5 capabilities
```

No prose-only “looks good” promotion.

## 18. Program definition of done

The coordinated program is complete only when:

- the first test organization sees only U5-certified business modules/horizontal surfaces;
- all enabled modules have profound primary workflow completion rather than route/reducer-only coverage;
- cross-module result records are directly navigable and canonical state survives refresh/reconnect;
- every enabled runtime concern has one obvious implementation authority;
- each production AI path uses the canonical executor;
- expected effects/errors/retries are owned and machine-readable;
- generated contracts describe every model-visible ERP capability;
- immutable released policy controls admitted skills/programs;
- consequential AI/offline operations reuse T0/INT/ADV-certified ERP workflows;
- WorkPrograms/sandboxes/artifacts/UI/CLI/automation converge on the same typed capability layer;
- authorization/tenancy/approval/idempotency/stale/residency/retention/deletion/sandbox/supply-chain gates pass for enabled classes;
- operators can inspect, reconcile, revoke and recover without database surgery;
- organization learning is explicit/reviewable/revocable/tenant-isolated;
- forensic causality exists without universal raw request/response shadow logging;
- optional advanced execution is separately admitted;
- model-refinement assets are governed/reproducible/reversible and never grant authority;
- disabled/deferred capabilities cannot be reached by alternate routes.

The **main roadmap ledger, mandatory COH ledger, and mandatory T0 COV ledger** together are the implementation checklists for this program.