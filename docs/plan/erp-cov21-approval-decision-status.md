# COV-21 — One evidence-backed human-task decision

**Status:** IMPLEMENTED — exact claim/decision readback; runtime acceptance pending  
**Module/surface:** Approvals / Workflows  
**Plan target:** one evidence-backed approval decision  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /approvals

Existing operations (already reachable from the frontend command layer):

- `claim_workflow_human_task` — hook: `frontend/packages/query-hooks/src/hooks/approvals.ts`
- `decide_workflow_human_task` — hook: `frontend/packages/query-hooks/src/hooks/approvals.ts`

Canonical resources: `workflow-human-tasks` (all statuses; the inbox variant lists only open/claimed tasks)

## Effect contract

Same human task id reads back its decision and decider; stale decision rejected; self-approval denied.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No contract delta.** The scaffold assumed no query resource existed. The api-server already serves
`/api/query/workflow-human-tasks` (every status, candidate-scoped, company-filtered) with `status`,
`decision`, `decided_by`, `claimed_by`, `revision` and the instance revision.

## Slice 1 — claim and decide one task (implemented)

The reducers already provide the domain guarantees this slice needs, covered by
`spacetimedb/tests/workflow/human_tasks_test.rs`: expected-revision stale rejection,
idempotency receipts (identical replay returns the original task; a changed input under the same key is
rejected), late/closed-task rejection, and self-approval denial. No reducer change.

- **Hooks:** `useClaimHumanTask` / `useDecideHumanTask` (`hooks/approvals.ts`) read
  `/api/query/workflow-human-tasks` after dispatch. `resolveHumanTaskClaimEffect` requires the exact task
  Claimed with a claimant at `expectedRevision + 1`; `resolveHumanTaskDecisionEffect` requires the exact
  task terminal with the requested decision and a decider (or, for an all-candidates task, an open task
  whose revision advanced by the recorded vote) (`human-task-effect.ts`). Duplicates raise
  `AmbiguousOperationEffectError`; a missing readback is an error, not a success.
- **UI:** unchanged — `/approvals` already has claim/approve/reject/comment with test ids.
- **Spec:** `cov21-approval-decision.spec.ts` reuses the purchase-order approval fixture
  (`@dev-fixture`, needs `seed_dev_data`): an independent approver approves through the UI, the PO
  confirms, an identical replay is a safe no-op (200, unchanged), a fresh-key decision is 422 with the
  task unchanged, and the reader persona is 403.
- **Semantics note:** the plan's "replay → 422" does not apply to an identical replay — the
  idempotency receipt makes that a safe success. The 422 proof uses a fresh idempotency key.

## Prerequisites / decisions

Approver persona and PO approval workflow fixture (provided by the spec via `seedPurchaseOrderApprovalWorkflow`).

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | EXISTING — `human_tasks_test.rs` (claim/decision/replay/stale/self-approval); no domain change in this slice |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — reader replay asserted 403 in the spec; not yet run |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — `frontend/web/tests/e2e/cov21-approval-decision.spec.ts`; not yet run against a seeded stack |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE (resolvers) — `human-task-effect.test.ts`; snapshot assertions written in the spec |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
