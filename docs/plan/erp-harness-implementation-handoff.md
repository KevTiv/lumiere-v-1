# ERP harness coordinator handoff

Use this template to start an implementation session against the coordinated ERP + harness program.

Primary plans:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md)
- [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md)
- [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md)
- [`../plans/erp-module-usability-parity-program.md`](../plans/erp-module-usability-parity-program.md)
- [`erp-module-usability-parity-ledger.md`](./erp-module-usability-parity-ledger.md)

## Coordinator startup

1. Read the coordination plan and the source plans for the package being assigned.
2. Inspect current `main`, open implementation PRs, accepted contracts pin, and active worktrees/agents.
3. Re-run or verify `BASE-00` before trusting historical task status.
4. Choose the latest accepted implementation revision as the execution base.
5. Update ledger statuses from evidence; do not redo delivered work merely because rows begin as `TODO`.
6. Run `COH-00` against that accepted base before broad GOV/CAP/WPR feature expansion.
7. Run `COV-00` before making module-completeness estimates or assigning large ERP completion packages; historical frontend/reducer matrices are not current truth.
8. Select only packages whose dependencies are accepted.
9. Reserve shared integration surfaces and one contract/codegen lane before delegation.
10. Keep the primary session free for review/integration; use workers for disjoint packages.

## Worker assignment prompt

```text
You are implementing one bounded Lumière ERP/harness work package.

Task ID:
Objective:
Promotion target: T0 / P0 / P1 / P2 / ...
Base revision:
Accepted prerequisites:
Source architecture/coordination plan sections:

If this is COV/module work:
Module/surface:
Current U-level and evidence:
Target U-level for this slice:
Primary workflow/sub-workflow owned by this task:
Explicit visible deferrals that must remain hidden:

Allowed files/directories/schemas:
Reserved files / other active owners:

Exact deliverables:

Invariants that must remain true:
- organization/actor authority is server-derived;
- company/capability scope may only narrow;
- generated contracts remain canonical for ERP structure;
- immutable released policy remains canonical for admitted skill/program behavior;
- SpacetimeDB/domain operations remain the business-state authority;
- no raw reducer/SQL/path/credential authority is introduced;
- consequential effects have exact/idempotent/reconcilable outcome ownership;
- consequential effects remain behind canonical workflow + approval semantics;
- expected failures retain typed meaning until the transport boundary;
- no critical persistence/audit/spend error is silently discarded;
- no generated artifact is hand-edited.

Cohesion checks:
- identify the canonical owner this task uses for identity, scope, capability, contract, execution, retry/idempotency and error/outcome semantics;
- do not introduce a second registry, implication map, spend path, draft protocol, policy source, workflow state owner or execution path;
- if a compatibility path is touched, record its owner and removal prerequisite;
- if the operation can have an uncertain side effect, define reconciliation rather than blind retry.

T0 module-parity checks when applicable:
- the feature is reachable from the owning business context, not only by reducer/hook existence;
- lifecycle state and valid next actions are understandable;
- successful writes converge on canonical readback and direct resulting-record links;
- loading/empty/error/denied/waiting/terminal states are real UI states;
- stale state, duplicate submit, retry/lost response and permission behavior are explicit;
- shared documents/activity/messages/approvals/audit capabilities are reused where applicable;
- no visible stub/dead action/fake local success is added;
- any unfinished capability remains hidden/disabled for the test organization.

Forbidden scope:
- unrelated cleanup/refactors;
- new architecture or duplicate registry/policy/runtime/workflow abstraction;
- edits to reserved files;
- contract publication/pinning unless explicitly assigned;
- disabling/loosening checks to make tests green;
- generic string errors where a stable expected outcome is required;
- latest-row discovery as the identity of a consequential create;
- exposing a partial module feature merely to increase route/reducer coverage;
- starting another ledger task.

Required validation:

Required handoff:
1. changed files;
2. canonical owners used/retired;
3. public API/schema/contract changes;
4. error/outcome/retry semantics changed or preserved;
5. workflow state before/after and resulting record refs;
6. tests added and exact commands/results;
7. tests not run and why;
8. discovered defects or architectural conflicts;
9. remaining integration work;
10. whether a contract release is now required;
11. compatibility code retained and its removal gate;
12. for COV work: resulting U-level, remaining U5 blockers, and visible deferrals hidden from the test org.

Stop and return to the coordinator if a dependency or contract expansion outside this assignment is required.
```

## Review checklist

For every worker return, the coordinator checks:

```text
[ ] diff stays inside task scope
[ ] no duplicated architecture or parallel authority path
[ ] canonical owner for each touched concern is obvious
[ ] org/company/role derivation remains trusted/server-owned
[ ] authorization and current-policy recheck points are correct
[ ] permission/capability semantics are intersection/narrowing based
[ ] retry/idempotency/stale-state behavior is explicit
[ ] consequential outcomes are exact/reconcilable
[ ] committed-but-response-lost cannot become blind duplicate retry
[ ] budget ownership cannot reset through retries/fallback/fork
[ ] expected failures preserve typed machine semantics
[ ] outcome-unknown is distinct from ordinary failure
[ ] no critical persistence/audit/spend failure is ignored
[ ] generated/source contracts remain canonical
[ ] immutable released policy is not reconstructed independently
[ ] compatibility path has an owner/removal gate
[ ] focused tests pass on integrated tree
[ ] adversarial/E2E evidence required by the task is actually run
[ ] contract release/pin boundary respected
[ ] ledger evidence/status updated only after acceptance

For COV/T0 work additionally:
[ ] feature is user-reachable from the owning workflow context
[ ] primary lifecycle remains STDB/domain-owned
[ ] canonical result is observed after mutation
[ ] created/downstream records are linked directly
[ ] loading/empty/error/denied/waiting/terminal UX exists
[ ] no new visible stub/dead tab/dead quick action
[ ] unfinished secondary capability is explicitly hidden/disabled
[ ] module U-level is supported by evidence, not assertion
[ ] test-org personas/seed work without DB surgery
[ ] responsive/refresh/reconnect behavior checked where required
```

## Suggested initial execution shape

After `BASE-00` and `BASE-02` confirm the repository/contracts state:

```text
Coordinator
  COH-00 authority + compatibility census
  COV-00 current module/operation parity census

Worker A
  BASE-03 communication correctness blockers

Worker B
  BASE-04 payment/import correctness blockers

Worker C
  current governed-loop validation / preparation for COH-01..04
```

`COH-00` and `COV-00` are audits over different concerns and may run concurrently if ownership is disjoint.

After those are accepted, maintain two parallel product lanes:

```text
ERP/T0 lane                         AI/P0 lane
───────────                         ──────────
COV-01 shared workflow result seam  COH/GOV canonical executor work
COV-02 seeded test org              SEC trusted envelope convergence
commercial/supply/finance modules   generated read capability admission
horizontal module parity            governed read-only pilot
```

Within ERP completion, prefer module groups with low overlap:

```text
Lane A  CRM → Sales
Lane B  Purchasing → Inventory → Manufacturing
Lane C  Accounting → Expenses / Subscriptions / POS
Lane D  HR → Projects → Helpdesk / Fleet / IoT
Lane E  Documents / Calendar / Messages / Reports / Approvals / Imports / Settings
```

Large module entries must be split into bounded suffix tasks (`COV-08a`, `COV-08b`, etc.) rather than one giant diff.

Do not activate a new production governed AI route against uncertain identity/capability/release semantics. Do not expose a non-U5 business module to the first test organization merely because its route exists. Contract release packages remain serialized through the coordinator.