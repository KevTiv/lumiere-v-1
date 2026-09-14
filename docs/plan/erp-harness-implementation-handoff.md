# ERP harness coordinator handoff

Use this template to start an implementation session against the coordinated ERP harness program.

Primary plans:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md)
- [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md)
- [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md)

## Coordinator startup

1. Read the coordination plan, cohesion plan, and both ledgers before editing.
2. Inspect current `main`, open implementation PRs, accepted contracts pin, and active worktrees/agents.
3. Re-run or verify `BASE-00` before trusting historical task status.
4. Choose the latest accepted implementation revision as the execution base.
5. Update ledger statuses from evidence; do not redo delivered work merely because rows begin as `TODO`.
6. Run `COH-00` against that accepted base before broad GOV/CAP/WPR feature expansion.
7. Select only packages whose dependencies are accepted.
8. Reserve shared integration surfaces and one contract/codegen lane before delegation.
9. Keep the primary session free for review/integration; use workers for disjoint packages.

## Worker assignment prompt

```text
You are implementing one bounded Lumière ERP/harness work package.

Task ID:
Objective:
Promotion target:
Base revision:
Accepted prerequisites:
Source architecture/coordination plan sections:

Allowed files/directories/schemas:
Reserved files / other active owners:

Exact deliverables:

Invariants that must remain true:
- organization/actor authority is server-derived;
- company/capability scope may only narrow;
- generated contracts remain canonical for ERP structure;
- immutable released policy remains canonical for admitted skill/program behavior;
- no raw reducer/SQL/path/credential authority is introduced;
- consequential effects have exact/idempotent/reconcilable outcome ownership;
- consequential effects remain behind certified capability + approval semantics;
- expected failures retain typed meaning until the transport boundary;
- no critical persistence/audit/spend error is silently discarded;
- no generated artifact is hand-edited.

Cohesion checks:
- identify the canonical owner this task uses for identity, scope, capability, contract, execution, retry/idempotency and error/outcome semantics;
- do not introduce a second registry, implication map, spend path, draft protocol, policy source or execution path;
- if a compatibility path is touched, record its owner and removal prerequisite;
- if the operation can have an uncertain side effect, define reconciliation rather than blind retry.

Forbidden scope:
- unrelated cleanup/refactors;
- new architecture or duplicate registry/policy/runtime abstraction;
- edits to reserved files;
- contract publication/pinning unless explicitly assigned;
- disabling/loosening checks to make tests green;
- generic string errors where a stable expected outcome is required;
- latest-row discovery as the identity of a consequential create;
- starting another ledger task.

Required validation:

Required handoff:
1. changed files;
2. canonical owners used/retired;
3. public API/schema/contract changes;
4. error/outcome/retry semantics changed or preserved;
5. tests added and exact commands/results;
6. tests not run and why;
7. discovered defects or architectural conflicts;
8. remaining integration work;
9. whether a contract release is now required;
10. compatibility code retained and its removal gate.

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
```

## Suggested first execution batch

After `BASE-00` and `BASE-02` confirm the current repository/contracts state, prefer this shape:

```text
Coordinator
  └── COH-00 authority + compatibility census

Worker A
  └── BASE-03 communication correctness blockers

Worker B
  └── BASE-04 payment/import correctness blockers

Worker C
  └── validation of current governed-loop stack / preparation for COH-01..04
```

After `COH-00` is accepted:

```text
Coordinator
  └── integration + reserved wiring + contract lane

Worker A
  └── COH-01 trusted execution context

Worker B
  └── COH-03 effective capability authority

Worker C
  └── COH-04 immutable release policy
```

Then parallelize `COH-02` typed outcomes/errors, `COH-05` generated contract/scope convergence, and `COH-09` file-boundary hardening where ownership permits.

Do not activate a new production governed route against uncertain identity/capability/release semantics. Existing governed-loop internals may be maintained, but P0 admission waits on the relevant accepted COH seams.

The next batches remain dependency-first rather than wave-first. ERP workflow certification can proceed in parallel, while contract release packages remain serialized.