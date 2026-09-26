# COV-19 — Record-linked activity completion (then message post)

**Status:** PARTIAL — activity completion IMPLEMENTED (runtime acceptance pending); message post still scaffolded  
**Module/surface:** Calendar / Comms  
**Plan target:** record-linked activity or message lifecycle  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /calendar, /messages

Existing operations (already reachable from the frontend command layer):

- `complete_activity` — hook: `frontend/packages/query-hooks/src/hooks/crm.ts`
- `post_message` — hook: `frontend/packages/query-hooks/src/hooks/messages.ts`

Canonical resources: activities, mail-messages

## Effect contract

Same activity id reads back `state` = done with its record back-link; message post resolves by a stable message key.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none for activity completion (`activities` exposes state); message post readback may need a stable message key exposed (check before implementing)



## Prerequisites / decisions

BASE-03 (communications correctness) must be landed.

## Slice 1 — activity completion (implemented)

- **Reducer:** `complete_activity` (`spacetimedb/src/crm/activities.rs`) now rejects an
  activity that is already done (`is_done` or `state = "done"`). Before this slice a
  replay re-stamped `date_done`/`updated_at` and wrote a second audit entry.
- **Hook:** `useCompleteActivity` (`frontend/packages/query-hooks/src/hooks/crm.ts`) reads
  `/api/query/activities` back after dispatch and resolves the exact row through
  `resolveCompletedActivityEffect` (`crm-activity-completion.ts`): same id, same
  organization, `state = "done"` and `is_done = true`. Duplicates raise
  `AmbiguousOperationEffectError`. Server errors now surface the reducer message.
- **No contract delta:** `activities` already projects `state` and `is_done`.

## D/A/O/E proof checklist (activity completion)

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | DONE — `test_complete_activity_rejects_replay` in `spacetimedb/tests/crm/relational_fk_test.rs` (cross-org rejection, completion, replay rejected with row unchanged) |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | DONE — `check_permission(activity, write)` + org match; reader replay asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | DONE — CRM → Activities → `entity-action-complete-activity` in `frontend/web/tests/e2e/cov19-activity-completion.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE — `crm-activity-completion.test.ts`; spec asserts the snapshot after both replays |

## Slice 2 — message post (still scaffolded)

`post_message` still needs a stable message key in the `mail-messages` projection before an
exact readback is possible (check whether this is a contract delta before starting).

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
