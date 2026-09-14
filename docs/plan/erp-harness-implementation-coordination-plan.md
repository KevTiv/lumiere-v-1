# ERP harness implementation: coordinated delivery program

Status: PROPOSED EXECUTION AUTHORITY — 2026-09-14.
Scope: remaining Lumière ERP + AI harness convergence work after the v0.3.46 capability foundation, including certified ERP workflows, governed agent execution, WorkPrograms, sandbox/runtime, security/residency, learning/introspection, and the optional model-refinement plane.
Execution owner: the primary implementation session acting as coordinator.
Execution ledger: [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md).

This document does not replace the architectural plans in `docs/plans`. Those plans remain the semantic and invariant specifications. This document owns **implementation sequencing, work-package boundaries, coordination, evidence, and promotion gates** so agents can execute bounded work without re-deciding architecture.

## 1. Why this plan exists

The harness roadmap is now spread across several strong plans, but those plans operate at different abstraction levels:

- capability IR/codegen;
- provider/tool transport and the governed loop;
- evidence, questions, replay, and knowledge;
- ERP workflow integration and adversarial invariants;
- WorkProgram runtime/UI/certification;
- sandbox analysis and ProgramWorkspace;
- security, residency, retention, and supply-chain certification;
- organization learning and forensic introspection;
- model-refinement datasets and model promotion.

That is useful for architecture but too broad for implementation agents. The failure mode to avoid is an agent receiving “implement WorkPrograms” or “finish HSEC” and then changing contracts, persistence, runtime, UI, and policy in one uncontrolled batch.

The operating model is instead:

```text
architecture plan
    ↓
coordinated work package
    ↓
1 bounded objective
1 ownership envelope
explicit prerequisites
explicit forbidden scope
focused validation
    ↓
coordinator review/integration
    ↓
promotion gate
```

A work package should normally fit one focused Luna session. Packages explicitly marked `2x` may require a follow-up session but must keep the same responsibility boundary.

## 2. Authority hierarchy

When plans overlap, use this precedence:

1. **Security/business invariants:** `harness-security-residency-sandbox-certification.md`, `adversarial-business-invariant-certification.md`, and current authorization/tenant contracts.
2. **Canonical contract ownership:** application-contract IR, generated capability metadata, reducer/operation history, immutable `lumiere-contracts` releases.
3. **Domain semantics:** `erp-workflow-integration-program.md` and domain-specific remediation/gap plans.
4. **Harness semantics:** `ai-harness-completion-plan.md`, `ai-enterprise-harness-plan.md`, `ai-unified-execution-capabilities-subagent-plan.md`.
5. **Reusable execution:** WorkProgram, sandbox, ProgramWorkspace, certification/security plans.
6. **Learning/forensics/model refinement:** HLEARN, INTRO, MLEARN plans.
7. **This document:** implementation sequencing and task ownership only.

If a work package reveals a semantic conflict between source plans, stop the package and return the conflict to the coordinator. Do not silently pick a new architecture.

## 3. Current starting point

Recheck this before execution; it is orientation, not completion evidence.

The latest harness implementation stack through the v0.3.46 pin has already established:

- typed provider tool-call transport;
- an authorized/generated tool registry seam;
- a bounded recorded agent loop;
- per-call policy evaluation;
- durable spend reservation/settlement primitives;
- provider-attempt state including `outcome_unknown`;
- durable run wait states;
- non-progress detection;
- generated capability artifact v2;
- three reviewed inventory read capabilities with generated provider schemas.

The major immediate gap is **reachability**: no production route currently drives the complete governed loop, so reviewed generated tools are not yet part of a real production agent execution path.

Separately, the pre-tenant adversarial branch has identified real correctness blockers, including cross-tenant messaging behavior, stale approval/recipient checks, payment retry semantics, conflicting idempotency-key replay, money/CSV concerns, and unproven durable reconstruction paths. Those defects remain production blockers until repaired and re-run.

The architecture plans added after that implementation stack are documentation-only and must not be mistaken for runtime delivery.

## 4. Product promotion targets

Do not use one binary “AI ready” label. Promotion is capability-scoped.

### P0 — governed read-only pilot

Required:

- one production route reaches the canonical governed loop;
- current actor/company authorization narrows generated capability ceilings;
- durable spend/provider-attempt behavior is active;
- candidate answers pass the admitted answer/evidence gate;
- no mutation path can execute directly;
- operator can inspect the run and reconcile ambiguous provider attempts;
- read-only authority/tenancy/fallback tests pass;
- first reviewed inventory workflow passes real E2E.

This is a pilot gate, not full ERP production readiness.

### P1 — single-agent production harness

Required:

- P0;
- AIH base M0–M7 equivalents: questions, diagnostics/repair, checked continuation, interrupt/resume/fork/compare, source/decision lineage, full answer gate, reviewed knowledge/change handling, run/admin surfaces;
- all production skills route through one execution authority or are explicitly disabled;
- generated capability surface covers admitted production use cases;
- underlying consequential ERP workflows have passed INT/ADV certification;
- current-policy reauthorization and action-draft approval invariants pass.

M8 specialist delegation and M9 lifecycle extensions may remain disabled.

### P2 — reusable new-generation ERP execution

Required:

- P1;
- one canonical WorkProgram compiler/runtime;
- checkpoint/resume and simulation/dry-run/preview/live semantics;
- sandbox dataset/evidence/artifact boundary;
- approved Python runtime profiles and Lumière SDK;
- WorkProgram certification/compatibility/dependency graph;
- shared ProgramRun UI;
- ProgramWorkspace available only where admitted;
- HSEC sandbox, residency, retention, and supply-chain gates for enabled profiles.

### P3 — learning + forensic production plane

Required:

- P2;
- observable decision trace and typed corrections;
- replay/comparison and ExperienceCases;
- governed organization preferences/knowledge/heuristics/recipes/skills;
- causal introspection event model, forensic index, admin API/UI, exports;
- retention/legal-hold/integrity rules for introspection data.

### P4 — optional advanced execution

Separately admitted:

- bounded specialist delegation (M8);
- typed lifecycle extensions (M9).

Disabled P4 capabilities do not block P1–P3.

### P5 — model-refinement plane

Separately admitted unless product policy explicitly makes it a launch requirement:

- training permissions and ExperienceCase compiler;
- immutable datasets/benchmarks;
- capability ranker and later task-specific models;
- model registry, shadow evaluation, canary promotion;
- optional vertical/private adapters.

No production trace is trainable by default.

## 5. Non-negotiable implementation invariants

Every work package must preserve these:

1. SpacetimeDB remains authoritative for business state and business transitions.
2. Casbin/current server policy remains the authorization authority.
3. Generated application contracts own supported ERP capability semantics.
4. Browser/model inputs never grant organization, company, role, capability, region, processor, credential, path, reducer, or SQL authority.
5. Child execution context may only narrow parent authority.
6. Consequential AI work is draft/approval/certified-capability work, never a direct model mutation path.
7. Generated artifacts are never hand-edited.
8. Immutable released contracts are never rewritten in place.
9. Sandbox code receives no standing ERP/Postgres/object-store/provider credentials.
10. Provider/sandbox fallback may never weaken residency, retention, training-use, disclosure, or authorization policy.
11. Durable state, permissions, budgets, approvals, and effect history cannot be reconstructed from model-written summaries.
12. Hidden model chain-of-thought is not persisted as audit/provenance.
13. A rejected operation must leave zero unauthorized or partial business-state delta.
14. AI failure must not block ordinary ERP operation.
15. A task is not complete because unit tests pass; its stated integration/evidence gate must pass.

## 6. Coordinator operating contract

The coordinator owns integration, not just delegation.

### Coordinator responsibilities

- Start from the latest **accepted implementation revision**, not whichever open branch is newest.
- Recheck current code, open PRs, generated-contract pin, and known failures before assigning a package.
- Maintain the execution ledger and accepted dependency graph.
- Assign disjoint file/surface ownership.
- Retain ownership of shared wiring and release-sensitive files unless explicitly transferred.
- Review actual diffs and surrounding code, not only agent summaries.
- Run integrated validation after each batch.
- Stop dependent work when a prerequisite package is not accepted.
- Record blockers as blockers; never convert missing live evidence into a pass.

### Recommended concurrency

With four agent slots:

```text
primary/coordinator: integration + review
worker A: runtime/backend package
worker B: independent domain/security/package
worker C: frontend/tests/contracts producer package
```

Never run two packages that both own the same contract/schema or shared registry surface.

### Reserved integration surfaces

Coordinator-owned by default:

- `ai-gateway/src/main.rs` and top-level route registration;
- canonical executor/run dispatch selection;
- `ai-gateway/src/tools/registry.rs` namespace integration when multiple packages touch it;
- shared harness exports/module declarations;
- `spacetimedb/src/ai/mod.rs` and shared AI schema/module wiring;
- Cargo manifests/lockfile;
- generated contract outputs;
- release manifests and contract pins;
- root frontend AI route exports/shared generated contracts;
- this plan and the execution ledger.

A package may receive one of these explicitly, but no competing owner may exist during that interval.

## 7. Contract and schema release protocol

Any work that changes STDB schema, operation signatures, generated capability metadata, shared JSON schemas, or canonical IR is split into three responsibilities:

```text
A. producer source change
   ↓
B. deterministic codegen + immutable contracts release
   ↓
C. consumer pin + runtime/frontend wiring
```

Rules:

- producer agents do not hand-edit staging/generated output;
- consumer code does not assume an unpublished contract;
- only one release lane is active at a time;
- publication/pinning is its own accepted package or coordinator action;
- operation history, tenant ownership, storage policy, capability artifact, schema compatibility, and release compatibility gates run before consumers advance;
- if a package discovers a needed contract expansion, it may prepare the producer change but must stop at its boundary unless the assignment explicitly includes the release lane.

This protocol is mandatory for WorkProgram, HLEARN, INTRO, and MLEARN persistence as well as the current harness tables.

## 8. Work-package shape

Every assignment uses this contract:

```text
Task ID and objective:
Promotion target / source plan IDs:
Base revision and accepted prerequisites:
Allowed files/directories/schemas:
Reserved files / active owners:
Exact deliverables:
Behavior/security invariants:
Forbidden scope:
Required focused validation:
Required integration evidence:
Contract release required? yes/no; producer/consumer side:
Required handoff:
  - changed files;
  - public API/schema changes;
  - tests added/run/skipped;
  - discovered defects;
  - unresolved integration work;
  - recommended next task only, no unassigned implementation.
```

Agent rules:

- do not broaden scope because adjacent code looks unfinished;
- do not add a second abstraction when one canonical owner already exists;
- do not add generic plugin systems, repositories, policy engines, registries, or DSLs unless the package explicitly calls for them;
- do not disable checks, loosen authorization, add blanket `allow` annotations, or create compatibility fallbacks just to make a slice pass;
- do not commit generated artifacts by hand;
- do not merge/push other agents' work;
- do not start the next package without coordinator assignment.

## 9. Acceptance loop for every worker result

1. Compare the diff to the package scope.
2. Reject opportunistic redesign/unrelated cleanup.
3. Inspect tenant/company derivation, authorization, retries, idempotency, stale-state behavior, budget ownership, and error semantics where relevant.
4. Verify generated/source contracts remain authoritative.
5. Integrate reserved wiring only after worker ownership ends.
6. Run focused tests on the combined tree.
7. Run the package's integration/adversarial gate.
8. Record accepted revision, changed paths, reviewer, commands/results, and remaining blockers in the ledger.
9. Only then unblock dependents.

An isolated green worker branch is evidence, not acceptance.

## 10. Execution lanes

The ledger groups packages into waves for readability, but work follows dependencies rather than strict serial waves.

### Lane A — governed runtime

Owns canonical loop reachability, answer admission, action drafts, provider attempts/spend, questions/recovery, and skill migration.

### Lane B — contracts/capabilities

Owns generated capability descriptors, result policies, operation schemas, scoped data/file/research capability contracts, and immutable releases.

### Lane C — ERP workflows/invariants

Owns human-reachable business workflows and ADV certification. AI exposure waits on this lane for consequential capabilities.

### Lane D — reusable execution

Owns WorkProgram/compiler/runtime, sandbox, artifact, ProgramWorkspace, and certification/compatibility.

### Lane E — security/residency

Owns execution envelopes, current-policy reauthorization, fence-hop tests, processor/residency policy, retention/deletion/legal hold, sandbox isolation, supply chain, and deployment attestations.

### Lane F — learning/forensics

Owns structured observable trace, corrections/replay/comparison, organization learning, INTRO causal events, forensic index/API/UI, retention and integrity.

### Lane G — model refinement

Owns training permissions, ExperienceCase compilation, immutable datasets/benchmarks, trainable models, model registry, shadow/canary, and adapters.

## 11. Dependency spine

The high-level dependency graph is:

```text
BASE / known-defect remediation
        ↓
GOV canonical runtime ───────────────┐
        ↓                            │
TRACE / interactive + answer gates   │
        ↓                            │
CAP generated/scoped capabilities ───┤
        ↓                            │
ERP INT + ADV certification ─────────┤
        ↓                            │
WPR reusable runtime                 │
        ↓                            │
SBX sandbox/artifact/workspace        │
        ↓                            │
SEC HSEC + supply-chain certification┘
        ↓
P2 promotion
        ↓
HLEARN + INTRO
        ↓
P3 promotion
       ↙  ↘
P4 M8/M9  MLEARN / P5
```

Important parallelism:

- SEC envelope/current-policy work starts alongside GOV; do not wait for the sandbox wave.
- ERP workflow certification proceeds independently of AI runtime plumbing.
- contract/codegen producer work can proceed in parallel with UI/operator work when releases do not collide.
- HLEARN schema design may start before P2, but replay/promotion cannot close before the underlying runtime is stable.
- MLEARN governance/compiler design may begin early, but production-derived training material cannot flow until HLEARN/INTRO/HSEC lineage exists.

## 12. Workstream outcomes

Detailed task cards and dependencies live in the ledger. The bounded outcomes are:

### BASE — integration baseline and known defects

Deliver one accepted implementation base, green contract/codegen baseline, repaired pre-tenant blockers, and an actually executed adversarial browser suite.

### GOV — canonical production execution

Deliver a real governed route that uses the durable loop, effective current-policy capability view, exact spend/provider-attempt handling, durable action-draft correlation, answer admission, legacy shutdown, and a read-only E2E pilot.

### TRACE — base interactive harness M0–M7 semantics

Deliver source/contribution/decision/component records, durable questions, typed diagnostics/repair, checked continuation, interrupt/resume/fork/compare, full claim/evidence validation, inspection, reviewed knowledge and source-change invalidation.

### CAP — production capability surface

Deliver generated reviewed ERP read descriptors, generated draft-only mutation descriptors, scoped SQL/template/data services where justified, tenant-file/research brokers, and migration of bundled skills/platform paths to the one executor.

### ERP — certified semantic business workflows

Deliver common workflow/action/result primitives, O2C/P2P golden paths, inventory/accounting and remaining pilot verticals, shared approvals, and ADV certification before AI/offline exposure.

### WPR — one reusable workflow runtime

Deliver immutable WorkProgram versions, compiler/graph, scheduler, durable ProgramRun/checkpoints, adapters, consequential/approval steps, automation/execution modes/UI, and certification/compatibility/dependency graph.

### SBX — isolated analysis and advanced workspace

Deliver provider-neutral sandbox execution, approved runtime profiles, opaque dataset handles, Python SDK/evidence/artifacts, recipe/skill promotion, ProgramWorkspace terminal/files, Lumière CLI, reproduction and collaborative artifact editing.

### SEC — authority/residency/retention proof

Deliver monotonic trusted execution envelopes, reauthorization/fence-hop tests, sandbox isolation, processor/residency routing, data-copy inventory, retention/deletion/legal-hold proof, approval/resume inheritance tests, supply-chain/revocation and deployment attestations.

### LEARN/INTRO — governed organization learning and forensics

Deliver observable decision trace, corrections/replay/comparison, ExperienceCases, organization patterns/preferences/knowledge/recipes, causal introspection capture/index, admin investigation API/UI/exports, integrity and retention.

### ADVAI — separately admitted advanced execution

Deliver bounded specialist delegation and typed lifecycle extensions only after base admission.

### MLEARN — governed model refinement

Deliver explicit training governance, dataset compiler/registry/benchmarks, capability ranker first, later tool/planning/verifier training, model registry/shadow/canary, and optional adapters without turning customer production traces into an implicit corpus.

## 13. Promotion evidence

A promotion gate is represented by an evidence record containing at least:

```text
promotion target
implementation revision(s)
contracts version(s)
configuration/runtime profile versions
focused unit/integration commands + result
E2E/adversarial commands + result
known expected skips and why
security/residency evidence where applicable
reviewer
open defects/deferrals
rollback/disable control
```

No prose-only “looks good” promotion.

## 14. Required system-level validation matrices

### Canonical execution matrix

For every admitted skill/program path:

```text
current actor allowed
current actor denied
company narrowed
permission revoked mid-run
provider fallback
budget exhausted
malformed tool call
repeated no-progress call
candidate answer validation fail
interrupt/reconnect/resume
```

### Consequential action matrix

For every admitted mutation workflow:

```text
valid draft
stale resource version
approval by unauthorized actor
self-approval where forbidden
approval then permission revocation
approval then draft mutation
committed-but-response-lost
idempotent retry
outcome unknown reconciliation
cross-tenant reference
```

### Sandbox matrix

For each enabled runtime profile:

```text
no standing secrets
network deny/default behavior
host path denial
cross-tenant scratch reuse
expired dataset handle
revoked dataset handle
artifact disclosure limits
resource/time exhaustion
snapshot/warm-pool cleanup
brokered external capability policy
```

### Residency/retention matrix

For each supported processor/region profile:

```text
allowed region
forbidden fallback
zero-retention requirement
training-use restriction
artifact placement
search/vector placement
sandbox placement
logs/traces classification
delete lifecycle
legal hold
backup/recovery inventory
```

## 15. Scope discipline for “new-generation ERP” work

The harness must not become a second ERP architecture.

Promote stable work downward over time:

```text
ad-hoc run
→ recipe
→ reviewed skill / WorkProgram
→ repeated broadly useful behavior
→ deterministic generated capability / first-class ERP feature
```

But promotion must preserve ownership:

- business rules move into STDB/domain code;
- capability shape moves into application IR/codegen;
- reusable orchestration stays in WorkProgram;
- presentation stays renderer-neutral;
- authorization stays server/Casbin owned;
- sandbox remains analysis/artifact execution only;
- training/model layers learn selection/reasoning patterns, never runtime authority.

This keeps the system extensible without accumulating permanent AI-only side paths.

## 16. Stop rules

Stop and return to the coordinator when:

- a package requires an unassigned contract/schema expansion;
- generated output differs unexpectedly from canonical source;
- current-policy authorization cannot be derived from server-owned context;
- a task would need raw SQL/reducer/path/credential authority not already admitted;
- a dependent workflow has not passed its business-invariant gate;
- a provider/sandbox fallback would weaken residency/privacy/retention;
- a consequential outcome is uncertain and cannot be reconciled;
- a test reveals cross-tenant or partial-business-state mutation;
- an agent would need to edit files owned by another active package;
- the only way to pass is to loosen a gate or disable a check.

## 17. Definition of done for the program

The full coordinated program is complete only when:

- each enabled production AI path uses one canonical execution authority;
- generated contracts describe every model-visible ERP capability;
- all enabled consequential operations reuse certified human ERP workflows;
- WorkPrograms, sandboxes, artifacts, UI, CLI, and automation converge on the same typed capability layer;
- all current-policy, tenancy, approval, retry, stale-state, residency, retention, deletion, sandbox and supply-chain gates pass for enabled capability classes;
- operators can inspect, interrupt, reconcile, revoke, reproduce where permitted, and roll back configuration/version promotion without database surgery;
- organization learning is explicit, reviewable, revocable and tenant-isolated;
- forensic causality exists without raw universal request/response shadow logging;
- optional specialists/extensions are independently admitted;
- model-refinement datasets/models are governed, reproducible, reversible, and never derive authority from learned weights;
- disabled/deferred capabilities are explicit and cannot be reached through alternate routes.

The execution ledger is the authoritative checklist for how this program is completed.