# COV-23 — Membership role assign → revoke

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Org / Settings / Auth  
**Plan target:** membership/role change and session recovery  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /settings

Existing operations (already reachable from the frontend command layer):

- `assign_role` — hook: `frontend/packages/query-hooks/src/hooks/auth.ts`
- `revoke_role` — hook: `frontend/packages/query-hooks/src/hooks/auth.ts`

Canonical resources: user-role-assignment

## Effect contract

Same (user_identity, role_id) assignment reads back `is_active` true then false; privilege escalation denied.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `user-role-assignment` exposes id, user_identity, role_id, organization_id, is_active



## Prerequisites / decisions

Admin + non-admin personas (first-org fixture has them).

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov23-role-assignment.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
