# ERP harness coordinator handoff

Use this template to start an implementation session against the coordinated ERP harness program.

Primary plans:

- [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)
- [`erp-harness-implementation-ledger.md`](./erp-harness-implementation-ledger.md)

## Coordinator startup

1. Read the coordination plan and ledger before editing.
2. Inspect current `main`, open implementation PRs, accepted contracts pin, and active worktrees/agents.
3. Re-run or verify `BASE-00` before trusting historical task status.
4. Choose the latest accepted implementation revision as the execution base.
5. Update ledger statuses from evidence; do not redo delivered work merely because rows begin as `TODO`.
6. Select only packages whose dependencies are accepted.
7. Reserve shared integration surfaces and one contract/codegen lane before delegation.
8. Keep the primary session free for review/integration; use workers for disjoint packages.

## Worker assignment prompt

```text
You are implementing one bounded Lumière ERP harness work package.

Task ID:
Objective:
Promotion target:
Base revision:
Accepted prerequisites:
Source architecture plan sections:

Allowed files/directories/schemas:
Reserved files / other active owners:

Exact deliverables:

Invariants that must remain true:
- organization/actor authority is server-derived;
- company/capability scope may only narrow;
- generated contracts remain canonical;
- no raw reducer/SQL/path/credential authority is introduced;
- consequential effects remain behind certified capability + approval semantics;
- no generated artifact is hand-edited.

Forbidden scope:
- unrelated cleanup/refactors;
- new architecture or duplicate registry/policy/runtime abstraction;
- edits to reserved files;
- contract publication/pinning unless explicitly assigned;
- disabling/loosening checks to make tests green;
- starting another ledger task.

Required validation:

Required handoff:
1. changed files;
2. public API/schema/contract changes;
3. tests added and exact commands/results;
4. tests not run and why;
5. discovered defects or architectural conflicts;
6. remaining integration work;
7. whether a contract release is now required.

Stop and return to the coordinator if a dependency or contract expansion outside this assignment is required.
```

## Review checklist

For every worker return, the coordinator checks:

```text
[ ] diff stays inside task scope
[ ] no duplicated architecture or parallel authority path
[ ] org/company/role derivation remains trusted/server-owned
[ ] authorization and current-policy recheck points are correct
[ ] retry/idempotency/stale-state behavior is explicit
[ ] consequential outcomes are exact/reconcilable
[ ] budget ownership cannot reset through retries/fallback/fork
[ ] generated/source contracts remain canonical
[ ] focused tests pass on integrated tree
[ ] adversarial/E2E evidence required by the task is actually run
[ ] contract release/pin boundary respected
[ ] ledger evidence/status updated only after acceptance
```

## Suggested first execution batch

After `BASE-00` confirms the current repository state, prefer this parallel shape when prerequisites allow:

```text
Coordinator
  └── BASE-01 / BASE-02 integration + contract baseline

Worker A
  └── GOV-00 canonical governed route

Worker B
  └── SEC-00 trusted execution envelope

Worker C
  └── BASE-03 or BASE-04 known-defect remediation
```

Do not start `GOV-00` against an uncertain implementation base; the example assumes BASE integration has been resolved or the current implementation stack is already accepted.

The next batches should continue dependency-first rather than wave-first. ERP workflow certification can proceed in parallel with harness/runtime work, while contract release packages remain serialized.