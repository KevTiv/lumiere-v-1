# COV-23 — Membership role assign → revoke

**Status:** IMPLEMENTED — runtime acceptance pending
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

## Implementation

- **Reducer:** `revoke_role` (`spacetimedb/src/core/permissions.rs`) now rejects an
  assignment that is already inactive. Before this, a replay re-audited the revoke and
  rebuilt the user's policy snapshot. `assign_role` already rejected a duplicate active
  assignment. `UserRoleAssignment` now derives `PartialEq` (Rust trait only; no schema or
  contract change) so the native proof compares whole rows.
- **Hooks:** `useAssignRole` / `useRevokeRole` (`frontend/packages/query-hooks/src/hooks/auth.ts`)
  read `/api/query/user-role-assignment` back after dispatch:
  - assign resolves the single active row for (organization, user identity, role) via
    `resolveActiveRoleAssignmentEffect`;
  - revoke resolves the same assignment id, same organization, `is_active = false` via
    `resolveRevokedRoleAssignmentEffect`.
  Both raise `AmbiguousOperationEffectError` on duplicates (`auth-role-assignment.ts`).
- **UI:** Settings → Users gains stable test IDs (`settings-user-row-<email>`,
  `settings-user-actions-<email>`, `settings-user-edit`, `settings-user-role-<roleId>`,
  `settings-user-save`). No behavior change.
- **No contract delta:** `user-role-assignment` already projects id, user_identity, role_id,
  organization_id and is_active.

## Wave 2 closure evidence (2026-10-13)

- The browser proof now observes a unique settings-read permission appear in a fresh target session
  after assignment and disappear after revoke. It also proves an administrator can create and persist
  a company switch while a company-bound reader's forged selection is repaired to the membership
  company after session recovery.
- Settings navigation is governed by an exhaustive exposure manifest: user sections are admitted,
  admin sections require admin authority, AI remains hidden, and unknown sections fail closed. Pure
  checks pass: company-scope resolver 3/3 and settings exposure ratchet 2/2. Playwright discovery
  succeeds as part of the 14-test Wave-2 selection.
- Security correction: organization-wide company access now uses the canonical single active
  membership base `role_id` plus active, unexpired assignments. Equal-now, expired, malformed expiry,
  inactive role, and ambiguous membership cases fail closed; pure Rust tests were added but could not
  run because Cargo is unavailable in this workspace.
- Runtime acceptance still requires the seeded same-head browser run. COV-26 must add settings/auth
  denied, keyboard/focus, viewport, and reconnect quality evidence; COV-27 must run the all-module
  launch manifest and prove no unclassified enabled operation or visible stub with required suites green.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | DONE — `test_role_assign_revoke_rejects_replay` in `spacetimedb/tests/core/tests/sod_test.rs` (duplicate assign rejected with no new row, cross-org revoke rejected with row unchanged, revoke persists inactive, replayed revoke rejected with row unchanged) |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | DONE — `check_permission(user_role_assignment, create/delete)`, org match, SoD and delegated-admin checks on assign; reader replays of both assign and revoke asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | DONE — Settings → Users → Edit → role checkbox → Save, for both assign and revoke, in `frontend/web/tests/e2e/cov23-role-assignment.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE — `auth-role-assignment.test.ts`; spec asserts the full assignment set for the test role after each replay |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
