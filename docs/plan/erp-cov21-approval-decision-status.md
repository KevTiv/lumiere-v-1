# COV-21 — One evidence-backed human-task decision

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Approvals / Workflows  
**Plan target:** one evidence-backed approval decision  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /approvals

Existing operations (already reachable from the frontend command layer):

- `claim_workflow_human_task` — hook: `frontend/packages/query-hooks/src/hooks/approvals.ts`
- `decide_workflow_human_task` — hook: `frontend/packages/query-hooks/src/hooks/approvals.ts`

Canonical resources: workflow human tasks (no resource yet)

## Effect contract

Same human task id reads back its decision and decider; stale decision rejected; self-approval denied.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** `workflow_human_task` has no query resource; a resource with id, organization_id, company_id, state/decision and decided_by is required

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Approver persona; SOD rule fixture.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov21-approval-decision.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
