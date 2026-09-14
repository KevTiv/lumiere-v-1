# ERP harness implementation: coordinated delivery program

**Status:** PROPOSED EXECUTION AUTHORITY — revised 2026-09-14  
**Scope:** remaining Lumière ERP + AI harness convergence after the v0.3.46 capability foundation  
**Execution owner:** primary implementation session acting as coordinator  
**Roadmap ledger:** [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md)  
**Mandatory cohesion plan:** [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md)  
**Cohesion ledger:** [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md)  
**Worker handoff:** [`erp-harness-implementation-handoff.md`](./erp-harness-implementation-handoff.md)

This document does not replace architectural plans in `docs/plans`. Those remain semantic/invariant specifications. This document owns **implementation sequencing, work-package boundaries, coordination, evidence, and promotion gates**.

## 1. Why this program exists

Lumière now has strong architecture plans across:

- application-contract IR/codegen;
- governed agent execution;
- ERP workflow integration and adversarial invariants;
- evidence/questions/recovery/knowledge;
- WorkPrograms;
- sandbox/data/artifacts/ProgramWorkspace;
- security/residency/retention/supply chain;
- replay/organization learning/forensics;
- optional model refinement.

Those documents are too broad to hand directly to implementation workers. The execution model is:

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

A task should normally fit one focused Luna session. `2x` tasks keep one responsibility boundary across two sessions.

## 2. Authority hierarchy

When plans overlap, use this precedence:

1. **Security/business invariants** — HSEC, ADV, current tenant/authorization contracts.
2. **Canonical ERP contract ownership** — application-contract IR, generated capability metadata, reducer/operation history, immutable `lumiere-contracts` releases.
3. **Domain semantics** — ERP workflow integration and domain remediation/gap plans.
4. **Harness semantics** — AI harness completion, enterprise harness, unified execution/capabilities.
5. **Reusable execution** — WorkProgram/sandbox/workspace/certification/security plans.
6. **Learning/forensics/model refinement** — HLEARN, INTRO, MLEARN.
7. **Repository cohesion plan** — resolves conflicts between multiple implementation generations of the *same* concern; it does not override semantic invariants above.
8. **This coordination document** — sequencing and ownership only.

If semantic plans materially conflict after applying this hierarchy, stop and return the conflict to the coordinator. Workers do not invent a third architecture.

## 3. Starting implementation state

Recheck through `BASE-00`; this is orientation, not acceptance evidence.

The recent harness stack has already introduced substantial foundations:

- typed provider tool-call transport;
- generated/authorized tool registry seams;
- bounded recorded loop;
- per-call policy checks;
- spend reservation/settlement primitives;
- provider attempts and `outcome_unknown`;
- durable run wait states;
- non-progress detection;
- generated capability artifact v2;
- first reviewed inventory read descriptors.

However, a focused implementation pass also found parallel generations still alive:

```text
legacy skill executor       + governed executor
legacy budget/spend         + reservation/attempt/settlement
latest-row draft lookup     + request-correlated draft creation
multiple action implication maps
compiled policy reconstruction + immutable released manifests
handwritten resource contracts + generated application IR
inconsistent company-scope semantics across schema/policy/tool view
request security fields     + planned trusted context
generic/payload step logs   + planned semantic evidence/forensics
opaque string/internal errors + desired typed outcomes
```

These seams are a mandatory cleanup target before broad new production capability work. See the COH plan/ledger.

Separately, the pre-tenant adversarial work found confirmed business defects in communication/payment/import/recovery paths. Those remain production blockers until repaired and re-run.

## 4. Sequencing spine

The current delivery spine is:

```text
BASE — accepted implementation + known defects
   ↓
COH — one authority / meaningful outcomes / seam eradication
   ↓
GOV — canonical governed production activation
   ↓
TRACE + CAP + ERP certification
   ↓
P1 single-agent production harness
   ↓
WPR — reusable WorkProgram runtime
   ↓
SBX — sandbox/data/artifacts/workspace
   ↓
SEC enabled-profile certification
   ↓
P2 reusable new-generation ERP execution
   ↓
LEARN + INTRO
   ↓
P3 learning + forensic plane
   ↙                 ↘
ADVAI/P4          MLEARN/P5
```

This is dependency-driven, not strictly serial:

- `BASE-03/04` business-defect remediation runs in parallel with COH;
- security trusted-context/envelope work starts with COH and must converge on one type/lineage;
- ERP human workflow/ADV certification proceeds independently of AI plumbing;
- contract producers may work in parallel when the single release lane is free;
- later schema design may begin early, but promotion gates cannot close before prerequisites.

## 5. Promotion targets

### Foundation gate — cohesive implementation

Before production P0 admission:

- one authority is chosen for identity, scope, capability, released policy, ERP structure, execution, spend and effect correlation;
- expected errors/outcomes retain machine semantics;
- consequential effects are exact/idempotent/reconcilable;
- no critical persistence/spend/audit error is silently discarded;
- compatibility paths have explicit owners and deletion gates;
- generated structural contracts and immutable released policy are not duplicated by handwritten runtime truth.

Detailed acceptance is `COH-12`.

### P0 — governed read-only pilot

Required:

- cohesive foundation accepted for relevant paths;
- one production route reaches the canonical governed loop;
- current actor/company authorization narrows reviewed generated tools;
- spend/provider-attempt lifecycle is active;
- candidate answers pass admitted answer validation;
- direct mutation is unreachable;
- run/provider ambiguity is inspectable/reconcilable;
- read-only authority/tenancy/fallback E2E passes.

### P1 — single-agent production harness

Required:

- P0;
- base interactive/recovery/evidence semantics equivalent to AIH M0–M7;
- all enabled production skills use one execution authority or are disabled;
- admitted generated/scoped capability surface covers production use cases;
- consequential ERP capabilities reuse certified human workflows;
- current-policy reauthorization/action-draft invariants pass;
- admin/operator surfaces expose runs, evidence, waits, errors and recovery.

M8/M9 may remain disabled.

### P2 — reusable new-generation ERP execution

Required:

- P1;
- immutable WorkProgram compiler/runtime;
- durable ProgramRun/checkpoint/resume;
- simulate/dry-run/preview/live modes;
- sandbox dataset/evidence/artifact boundary;
- approved Python runtime profiles + Lumière SDK;
- WorkProgram certification/compatibility/dependency graph;
- shared ProgramRun UI;
- HSEC/supply-chain gates for every enabled runtime profile.

### P3 — learning + forensic production plane

Required:

- P2;
- observable decision/correction/replay/comparison;
- ExperienceCases and governed org preferences/knowledge/heuristics/recipes/skills;
- causal introspection event/index/API/UI/export;
- retention/legal-hold/integrity for forensic data.

### P4 — optional advanced execution

Separately admitted:

- bounded specialists;
- typed lifecycle extensions.

### P5 — model-refinement plane

Separately admitted unless product policy changes:

- training permissions;
- ExperienceCase compiler;
- immutable datasets/benchmarks;
- capability ranker and later task models;
- model registry/shadow/canary;
- optional private/vertical adapters.

Production traces are never trainable by default.

## 6. Non-negotiable implementation invariants

Every task preserves:

1. STDB owns business state and canonical transitions.
2. Current server/Casbin policy owns ERP permission.
3. Generated application contracts own ERP structural capability semantics.
4. Immutable released skill/program manifests own admitted execution policy.
5. Browser/model input never grants org/company/role/capability/region/processor/credential/path/reducer/SQL authority.
6. Child execution only narrows parent authority.
7. Agent configuration narrows; it does not become permission authority.
8. Consequential AI effects are draft/approval/certified capability effects, not direct model mutation.
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

## 7. Meaningful code and outcome ownership

A cohesive path should read:

```text
thin transport adapter
→ trusted context + typed intent
→ application service/executor
→ generated/domain capability
→ infrastructure adapter
→ typed outcome/error
→ one transport mapper
```

Expected consequential outcomes are semantically one of:

```text
Applied
AlreadyApplied / NoOpReplay
Rejected
Waiting
OutcomeUnknown(reconciliation ref)
```

Expected failures should preserve stable classes such as invalid input, forbidden, stale/conflict, precondition, rate/budget, dependency unavailable, timeout and outcome unknown until the API/UI boundary.

Do not solve this with a giant global error enum. Cohesive subsystems own typed errors and convert once at boundaries.

## 8. Coordinator operating contract

The coordinator owns integration, not only delegation.

Responsibilities:

- start from latest **accepted** revision;
- inspect current code/open PRs/contracts/known failures before assignment;
- reconcile historical work through `BASE-00`, not assumptions;
- run `COH-00` before broad production capability expansion;
- maintain both ledgers and accepted dependency graph;
- reserve shared integration surfaces;
- review actual diffs and surrounding code;
- inspect authority, retry/idempotency, stale-state, error/outcome and effect certainty;
- run integrated validation after batches;
- stop dependent work when prerequisites are not accepted;
- record blockers rather than converting missing evidence into passes.

With four slots:

```text
primary coordinator: integration/review/release lane
worker A: runtime/backend package
worker B: independent domain/security package
worker C: frontend/tests/contract-producer package
```

## 9. Reserved integration surfaces

Coordinator-owned by default unless transferred explicitly:

- `ai-gateway/src/main.rs` and root route registration;
- canonical execution dispatch selection;
- shared trusted-context integration;
- `ai-gateway/src/tools/registry.rs` when multiple packages touch it;
- shared harness/orchestrator module exports;
- shared AI schema/module wiring under STDB;
- Cargo manifests/lockfile;
- generated contract output/staging;
- release manifests and contract pins;
- root frontend shared generated/API exports;
- coordination plans/ledgers.

One owner at a time for any schema/registry/release surface.

## 10. Contract/schema release protocol

Any task changing STDB schema, operation signatures, generated capability metadata, shared schemas, or canonical IR splits into:

```text
A producer source change
      ↓
B deterministic codegen + immutable contracts release
      ↓
C consumer pin + runtime/frontend wiring
```

Rules:

- producer does not hand-edit generated output;
- consumer does not assume unpublished contract;
- one release lane at a time;
- publication/pinning is an explicit package/coordinator action;
- operation history, tenant ownership, storage policy, capability artifact, schema/release compatibility gates run before consumers advance;
- discovered contract expansion stops the current task unless its assignment explicitly includes that lane.

Applies equally to current harness, WorkProgram, HLEARN, INTRO and MLEARN persistence.

## 11. Work-package assignment contract

Every worker receives:

```text
Task ID/objective
promotion target/source-plan sections
base revision + accepted prerequisites
allowed files/schemas
reserved files/active owners
exact deliverables
behavior/security/outcome invariants
forbidden scope
focused validation
integration evidence required
contract release side: none | producer | publisher | consumer
handoff requirements
```

Workers must not:

- broaden scope because adjacent code is unfinished;
- add another registry/policy/executor/context/error abstraction when a canonical owner exists;
- preserve duplicate logic by copying it into a “shared” third implementation;
- disable checks/authorization or add fallbacks just to pass;
- introduce latest-row effect discovery;
- turn expected outcome semantics into string parsing;
- discard critical persistence errors;
- edit generated output manually;
- publish/pin contracts unless assigned;
- start another task without coordinator assignment.

## 12. Acceptance loop

For every worker return:

1. compare diff to assigned scope;
2. identify canonical owners touched/retired;
3. reject opportunistic redesign and parallel authority;
4. inspect org/company/current-policy derivation;
5. inspect capability narrowing and released-policy use;
6. inspect retry/idempotency/stale/outcome-unknown behavior;
7. inspect typed error/outcome propagation;
8. inspect critical persistence/audit/spend failure handling;
9. verify generated contracts remain structural truth;
10. integrate shared wiring after worker ownership ends;
11. run focused checks on integrated tree;
12. run required adversarial/E2E gate;
13. record revision, reviewer, commands/results, compatibility remnants and blockers;
14. unblock dependents only after acceptance.

An isolated green worker branch is evidence, not acceptance.

## 13. Execution lanes

### Lane A — BASE / business correctness

Accepted integration baseline, known communication/payment/import/recovery defects and pre-tenant E2E.

### Lane B — COH / authority and outcome convergence

Trusted context, capability authority, immutable release consumption, generated structural contracts, scope consistency, exact effect correlation, one executor/spend path, typed errors/outcomes, semantic events, file boundary and compatibility ratchets.

### Lane C — GOV/TRACE

Canonical production loop activation, answer/action gates, questions, repair, continuation, session controls, evidence and knowledge.

### Lane D — CAP/contracts

Generated/scoped capabilities and serialized immutable releases.

### Lane E — ERP/ADV

Human canonical workflows and business-invariant certification.

### Lane F — WPR/SBX

Reusable runtime, sandbox, artifacts, workspace and CLI.

### Lane G — SEC

Authority/residency/retention/sandbox/supply-chain proof. SEC context/envelope work must converge with COH context rather than create a sibling type.

### Lane H — LEARN/INTRO

Decision trace, corrections/replay/org learning and forensic causal platform.

### Lane I — ADVAI/MLEARN

Separately admitted specialists/extensions and model refinement.

## 14. System validation matrices

### Canonical execution

For each admitted AI/program path:

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

For each admitted mutation workflow:

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

For protected API/UI paths:

```text
invalid input
unauthenticated / forbidden
not found
stale/conflict
precondition
rate/budget
retryable dependency failure
timeout
outcome unknown
internal invariant
```

Verify stable code, safe message, correlation ID and correct retry advice. No client behavior may depend on parsing internal strings.

### Sandbox

```text
no standing secrets
network deny/default
host-path denial
cross-tenant scratch reuse
expired/revoked dataset handle
artifact disclosure limits
resource/time exhaustion
snapshot/warm-pool cleanup
brokered external capability
```

### Residency/retention

```text
allowed region
forbidden fallback
zero-retention/training-use constraints
artifact/search/vector/sandbox placement
logs/traces classification
delete lifecycle
legal hold
backup/recovery inventory
```

## 15. New-generation ERP scope discipline

The harness is not a second ERP architecture.

Stable work should graduate downward:

```text
ad-hoc run
→ recipe
→ reviewed skill / WorkProgram
→ repeated broadly useful behavior
→ deterministic generated capability / first-class ERP feature
```

Ownership stays clear:

- business rules → STDB/domain;
- capability structure → application IR/codegen;
- reusable orchestration → WorkProgram;
- presentation → renderer-neutral UI contracts;
- authorization → server/Casbin;
- sandbox → isolated analysis/artifact execution;
- training/model layers → selection/reasoning patterns, never runtime authority.

## 16. Stop rules

Stop and return to coordinator when:

- task requires unassigned schema/contract expansion;
- generated output unexpectedly differs from canonical source;
- there are two plausible authorities for the same concern and COH has not resolved them;
- current authorization cannot be derived from trusted server context;
- task needs raw SQL/reducer/path/credential authority not admitted;
- dependent business workflow has not passed its invariant gate;
- fallback would weaken residency/privacy/retention/training-use;
- consequential outcome is uncertain without a reconciliation contract;
- expected failure semantics would need string parsing or generic 500 to proceed;
- critical persistence failure would have to be ignored;
- test reveals cross-tenant/partial business mutation;
- worker would need files owned by another active task;
- only path to green is loosening a gate/disabling a check.

## 17. Promotion evidence

Every promotion record includes at least:

```text
promotion target
implementation revision(s)
contracts version(s)
config/runtime versions
focused tests/results
E2E/adversarial results
expected skips + justification
security/residency evidence when applicable
error/outcome matrix evidence
reviewer
open defects/deferrals
rollback/disable control
```

No prose-only “looks good” promotion.

## 18. Program definition of done

The coordinated program is complete only when:

- the repository exposes one obvious authority for every enabled runtime concern;
- each production AI path uses the canonical executor;
- expected effects/errors/retries are owned and machine-readable;
- generated contracts describe every model-visible ERP capability;
- immutable released policy controls admitted skills/programs;
- consequential AI operations reuse certified canonical ERP workflows;
- WorkPrograms/sandboxes/artifacts/UI/CLI/automation converge on the same typed capability layer;
- authorization/tenancy/approval/idempotency/stale/residency/retention/deletion/sandbox/supply-chain gates pass for enabled classes;
- operators can inspect, reconcile, revoke, resume/reproduce where allowed and roll back configuration/version promotion without database surgery;
- organization learning is explicit/reviewable/revocable/tenant-isolated;
- forensic causality exists without universal raw request/response shadow logging;
- optional advanced execution is separately admitted;
- model-refinement assets are governed/reproducible/reversible and never grant authority;
- disabled/deferred capabilities cannot be reached by alternate routes.

The **main roadmap ledger plus the mandatory COH ledger** are the implementation checklists for completing this program.