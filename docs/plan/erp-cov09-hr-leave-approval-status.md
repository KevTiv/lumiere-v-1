# COV-09 — Leave request submit → approve/refuse

**Status:** IMPLEMENTED — runtime acceptance pending  
**Module/surface:** HR / Payroll  
**Plan target:** employee contract → leave/time/pay  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /hr → Leave

Existing operations (already reachable from the frontend command layer):

- `submit_leave` — hook: `frontend/packages/query-hooks/src/hooks/hr/leave.ts`
- `approve_leave` — hook: `frontend/packages/query-hooks/src/hooks/hr/leave.ts`
- `refuse_leave` — hook: `frontend/packages/query-hooks/src/hooks/hr/leave.ts`

Canonical resources: leave-requests, leaves-to-approve

## Effect contract

Same leave id, scoped by organization_id + company_id, reads back `state` after each transition; self-approval must be denied (separation of duties).

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `leave-requests` exposes id, organization_id, company_id, employee_id, state



## Prerequisites / decisions

Needs an HR manager persona distinct from the employee persona in the first-org fixture.

## Implementation

- **Reducers:** `submit_leave`, `approve_leave` and `refuse_leave` (`spacetimedb/src/hr/leaves.rs`)
  already rejected wrong-state transitions (so replays fail), and `approve_leave` already
  rejected self-approval through the employee's linked `user_id`.
- **Separation-of-duties fix:** a leave over 5 days needs two approvals
  (`Confirm → ValidatedOne → Validated`). The second approval did not check the approver,
  so one person could give both. It now rejects `second approval must come from a
  different approver` when the caller is the first approver.
- `HrLeave` now derives `PartialEq` (Rust trait only; no schema or contract change) so the
  native proof compares whole rows.
- **Hooks:** `useSubmitLeave` / `useApproveLeave` / `useRefuseLeave`
  (`frontend/packages/query-hooks/src/hooks/hr/leave.ts`) read `/api/query/leave-requests`
  back and resolve the same leave id, organization and company in the expected state via
  `resolveLeaveStateEffect` (`hr-leave-approval.ts`). Approval accepts `ValidatedOne` or
  `Validated`; if a workflow gate routed it to review (still `Confirm`) the hook says so.
  Reducer errors (for example self-approval) now reach the toolbar error.
- **No contract delta:** `leave-requests` already projects id, organization_id, company_id and state.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | DONE — `test_leave_approval_rejects_replay_and_self_approval` in `spacetimedb/tests/hr/wave_a_test.rs`: submit/approve/refuse replays, refuse-after-approve and approve-after-refuse, same-person second approval on a 6-day leave, and self-approval — each rejected with the row unchanged |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | DONE — `check_permission(hr_leave, update/approve)` + org and company guards; reader replays of approve and refuse asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | DONE — the `hr-project` persona runs Submit, Approve and Refuse from the HR → Leaves toolbar in `frontend/web/tests/e2e/cov09-hr-leave-approval.spec.ts`; its approval of its own leave returns 422 |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE — `hr-leave-approval.test.ts`; spec asserts the id/org/company/state snapshot after every replay |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).

## U5 closure increment — payroll approval and GL handoff

- `confirm_payslip` now denies an employee approving their own payslip by resolving the
  payslip's employee and comparing its linked `user_id` with the authenticated caller.
  `test_payslip_approval_rejects_self_approval` proves the denial leaves the Draft row
  unchanged.
- Confirm, post and cancel hooks now use canonical cache-independent readback of the exact
  organization/company/payslip identity. Ambiguous transport outcomes are reconciled and are
  never automatically redispatched.
- Payroll posting is successful only after the exact payslip is `Done`, carries a non-null
  `account_move_id`, and that exact scoped account move exists. This supplies the canonical
  employee-to-payroll-to-GL result reference.
- The cancel hook's transposed `companyId`/`payslipId` payload was corrected.

Still required for whole-module U5: current-head browser execution of employee → contract →
payslip → distinct-person approval → post/export, sensitive-field denied-reader proof, and
the shared responsive/accessibility/reconnect and launch-manifest gates.

Wave 2 adds that browser proof in `cov09-hr-payroll-lifecycle.spec.ts`: the primary employee,
contract and payslip records are created through visible forms; the seeded `hr-project`
persona approves and posts; the approval response is deliberately lost after commit and the
hook converges through exact readback; a duplicate post retains one exact GL relation; and
the reader persona is denied compensation fields (or the whole payslip feed) and the posting operation. Same-head runtime
execution and the shared certification gates remain required before promotion.

## STP fail-closed boundary (2026-10-13)

The prior visible STP action fabricated `stp-stub-*` submission ids, and native
intent processing could fabricate `stub:<kind>:<id>` result references. Both
synthetic-success paths are removed. Until a real provider adapter is configured,
the visible action reports STP as unavailable and dispatches no operation.

Native statutory intent processing now persists a canonical `failed` outcome
with an unavailable-provider error. A statutory result cannot become `sent` or
`applied` without a non-empty provider `external_ref` or `result_ref`. The native
test `test_statutory_integration_requires_canonical_provider_result` covers the
unavailable transition, rejected reference-free success with an unchanged row,
and exact recovery after a canonical provider receipt. The browser lifecycle
asserts the unavailable action emits no create-intent request. HR remains non-U5
until the provider adapter and these proofs run in the release environment.
