# COV-19 — Record-linked activity completion (then message post)

**Status:** IMPLEMENTED — activity completion and message post; runtime acceptance pending  
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

**Activity completion:** no generated contract delta (`activities` exposes state).

**Message post:** one contract delta — `post_message` takes an optional trailing `idempotency_key`. No table, column or projection change: the key is stored in the existing `mail_message.metadata` JSON and read back from the existing `mail-messages` projection.



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

## Slice 2 — message post (implemented)

`post_message` returns nothing and the row it creates carried no caller-owned identity, so the
only exact readback was "newest row with this body", the heuristic COV-00C bans.

- **Reducer:** `post_message` (`spacetimedb/src/core/messaging.rs`) takes an optional
  `idempotency_key` (1-128 chars after trim) and stores it as `{"idempotency_key": …}` in
  `metadata`. The key is scoped to the caller within the organization. Re-sending it with the
  same message returns success without a second row, a second follower notification or a second
  audit entry; re-using it for a different message (model, record, body, parent or attachments)
  is rejected. Without a key the call always creates a message, as before. `MailMessage` derives
  `PartialEq` (Rust trait only; no schema change).
- **Hook:** `usePostMessage` (`frontend/packages/query-hooks/src/hooks/messages.ts`) sends a fresh
  key per call (or the caller's `idempotencyKey`), reads `/api/query/mail-messages` back and
  resolves the exact row through `resolvePostedMessageEffect` (`mail-message-post.ts`): the row
  carrying that key, in the same organization, model and record. Duplicates raise
  `AmbiguousOperationEffectError`; a missing row fails the mutation instead of reporting success.
- **Not covered:** the key is generated per call, so a user who re-submits after a lost response
  still posts a second message. Holding one key per draft is a UX follow-up.

## D/A/O/E proof checklist (message post)

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: keyed create, replay converges, key reuse rejected, invalid keys rejected, distinct keys and unkeyed posts each create | WRITTEN — `test_post_message_idempotency` in `spacetimedb/tests/core/tests/chatter_post_message_test.rs` (registered as `run_core_chatter_post_message_test` and in `run_all_core_tests`) |
| A | `mail_message:create` permission kept; reader persona denied (403) | Spec asserts reader post 403 (`fixture-limited-read-only` holds only `organization:read`) |
| O | Playwright drives the post through the visible Messages "new message" form | WRITTEN — `frontend/web/tests/e2e/cov19-message-post.spec.ts` (not yet run against a stack) |
| E | Exact-effect resolver unit test and browser snapshot preserved after replay (200), key-reuse conflict (422) and denied replay (403) | Resolver DONE — `mail-message-post.test.ts`; snapshot asserted in the spec |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
