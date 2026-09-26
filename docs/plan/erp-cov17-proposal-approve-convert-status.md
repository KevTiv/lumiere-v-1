# COV-17 — Versioned review → approve → convert to sale order

**Status:** PARTIAL — award approval IMPLEMENTED (runtime acceptance pending); conversion to sale order still scaffolded  
**Module/surface:** Proposals  
**Plan target:** versioned review → canonical conversion  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /proposals

Existing operations (already reachable from the frontend command layer):

- `approve_proposal` — hook: `frontend/packages/query-hooks/src/hooks/proposals.ts`
- `convert_proposal_to_sale_order` — hook: `frontend/packages/query-hooks/src/hooks/proposals.ts`

Canonical resources: proposals, sale-orders

## Effect contract

Same proposal id reads back approved `status`; conversion resolves the created sale order through the proposal→order relation.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `proposals` exposes status, sale_order_id and project_id, so approve and convert resolve through the proposal's own relations



## Prerequisites / decisions

Reviewer persona distinct from author.

## Slice 1 — award approval (implemented)

- **Reducer fixes** (`approve_proposal`, `spacetimedb/src/proposals/proposals.rs`):
  - a replay re-stamped `award_approved_at` / `award_approved_by` (the status stays
    `Submitted`); it now rejects `Proposal is already approved for award`;
  - the "SoD gate" never checked the author; it now rejects `cannot approve your own
    proposal for award` when the caller is the proposal's `create_uid`.
- `Proposal` now derives `PartialEq` (Rust trait only; no schema or contract change).
- **Readback:** `award_approved_at` is not projected, so the exact effect is the UI's award
  step: `useUpdateProposalStatus` reads `/api/query/proposals` back and resolves the same id,
  organization and company in the requested status via `resolveProposalStatusEffect`
  (`proposal-award.ts`). `useApproveProposal` now surfaces reducer errors.
- **Existing spec:** `proposals-lifecycle.spec.ts` created and approved as the same admin; its
  fixture proposal is now authored by the owner identity so the admin approves as a second person.

## D/A/O/E proof checklist (award approval)

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | DONE — `test_award_approval_rejects_self_and_replay` in `spacetimedb/tests/proposals/convert_integrity_test.rs`: self-approval, approval replay, award replay and approve-after-award — each rejected with the row unchanged |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | DONE — `check_permission(proposal, approve/write)` + scoped load; reader replays of approve and award asserted 403 |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | DONE — Proposals → Award in `frontend/web/tests/e2e/cov17-proposal-approve-convert.spec.ts`; the admin's own proposal is refused (422) and stays Submitted |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE — `proposal-award.test.ts`; spec asserts the id/org/company/status/sale-order snapshot after every replay |

## Slice 2 — conversion (pending)

`convert_proposal_to_sale_order` already rejects a second conversion (`sale_order_id` set).
Remaining: drive it from the UI and resolve the created order through `proposals.sale_order_id`
(projected) with stale/denied replays.

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
