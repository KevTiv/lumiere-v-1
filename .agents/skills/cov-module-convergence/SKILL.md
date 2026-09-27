---
name: cov-module-convergence
description: >-
  Execute one bounded Lumiere ERP COV module/workflow convergence slice without
  introducing duplicate authority, heuristic effect discovery, false UI success,
  or weak operator-path evidence. Use for COV-01+ module work and U2/U3→U4/U5
  convergence.
---

# COV Module Convergence

You are a bounded implementation worker. Your job is to improve one assigned operator workflow while preserving Lumière's canonical authority and producing evidence the coordinator can review.

## Read first

Read only the relevant sections plus the assigned module/domain files:

1. `docs/plan/erp-cov00-current-module-matrix.md`
2. `docs/plans/erp-module-usability-parity-program.md`
3. `docs/plan/cov-canonical-operation-prototype.md`
4. `docs/plan/cov-agent-execution-trail.md`
5. the assigned domain plan / ADV invariant plan

Do not infer completion from older roadmap prose when current source disagrees.

## Non-negotiable authority chain

```text
user intent
→ UI presentation
→ module application/query hook
→ generated named operation contract
→ api-server trusted context/current authorization
→ STDB domain reducer/business state
→ canonical readback/result record ref
→ typed outcome
→ UI feedback/navigation
```

You may narrow this chain. You may not create a sibling mutation authority.

## Before editing

Produce a short current-path trace with concrete files/functions:

```text
component/action:
hook/application service:
generated operation:
server route:
STDB owner:
affected canonical resources:
stable effect identity:
result readback:
operator E2E:
```

If `stable effect identity` is unknown, stop implementation and report a contract/invariant blocker.

## Canonical mutation protocol

For consequential or cross-module actions:

```text
exact pre-read
  → existing one effect: AlreadyApplied(ref)
  → multiple effects: invariant failure
  → none: dispatch once
             ↓
        exact post-read
          → one: Applied(ref)
          → none/failed: OutcomeUnknown
          → multiple: invariant failure
```

Use `executeOperationWithCanonicalReadback` on prototype/migrated paths when applicable.

Transport `{ ok: true }` is only `accepted`. Never relabel it as `Applied` without canonical effect readback.

## Hard stops

Stop and hand back to the coordinator if:

- generated operation/IR is missing or stale;
- schema/operation signature must change and you do not own the release lane;
- the effect can only be found by latest/newest row, name/partner/amount/date heuristics, or sleep timing;
- more than one canonical effect exists for a 0..1 relation;
- permission/current-company behavior is unclear;
- the UI primary lifecycle is absent and the only available proof is a direct reducer call;
- a new shared outcome/error/record-ref owner is required;
- first-org exposure of the surface is unclassified.

Reporting a blocker is a correct outcome. Hiding it is not.

## Forbidden shortcuts

Do not:

- choose latest/newest IDs after mutation;
- use `setTimeout`/sleep as correctness;
- auto-retry an ambiguous consequential mutation;
- add a new cross-module `useMutation<void>`;
- parse error message strings in components;
- show success toast/close modal solely because HTTP returned 2xx;
- use `/compat/reducer/` when a generated operation exists;
- pass org/role/permission authority from the browser;
- recreate STDB business rules in React;
- use global cache invalidation as result identity;
- swallow mutation/readback errors;
- edit generated contracts manually;
- claim U5 from route/form/domain-test presence;
- use a direct reducer call for the exact transition an operator E2E claims to prove.

## Implementation preference

Keep responsibilities narrow:

```text
UI component
  owns: intent + rendering + navigation

application/query hook
  owns: input finalization + operation dispatch + effect readback + cache convergence

api client
  owns: transport decoding + typed transport failures

api-server
  owns: trusted context + current authorization + operation dispatch

STDB
  owns: business invariants + canonical transition/idempotency
```

Do not turn a generic hook/helper into a business-rule engine.

## Verification

Minimum for a migrated cross-module action:

1. typed transport/error unit coverage;
2. effect resolver zero/one/multiple tests;
3. domain idempotency/rejection invariant tests;
4. hook/application integration where practical;
5. Playwright actual UI action → canonical readback/result link;
6. relevant permission/stale/duplicate/lost-response tests.

Direct BFF calls may supplement browser coverage. They cannot replace the primary operator action for U5.

## Return format

Return exactly this evidence shape:

```text
Task / base SHA
Files changed
Before path
After path
Canonical owners reused
Effect identity + cardinality
Resulting record ref
Typed outcomes/errors
Tests run (command + result)
Operator proof
Compatibility/debt retired
Remaining blocker/deferral
Contract release required: yes/no
Next bounded task
```

Do not say “done” when a required acceptance item is unproven. Use `REVIEW`/`BLOCKED` language and name the missing evidence.
