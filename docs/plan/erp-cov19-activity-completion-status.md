# COV-19 — Record-linked activity completion (then message post)

**Status:** IMPLEMENTED — activity completion and message post (runtime acceptance pending); message post has no idempotency key  
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

## Slice 2 — message post (implemented, without an idempotency key)

- **Finding:** `post_message` (`spacetimedb/src/core/messaging.rs`) takes no client request id, the
  `mail-messages` projection exposes no author or key (`model`, `body`, `date`, `res_id`), and a post is
  deliberately not deduplicated — posting the same body twice is two messages. Adding a request id would
  change a public reducer's signature and every generated contract artifact, so it is not done here.
- **Hook:** `usePostMessage` (`frontend/packages/query-hooks/src/hooks/messages.ts`) reads
  `/api/query/mail-messages` before and after dispatch and resolves the one new row for the exact
  organization, model, record and body (`resolvePostedMessageEffect`, `mail-message-post.ts`). No new row
  means the post did not land; two identical new rows (a concurrent identical post) raise
  `AmbiguousOperationEffectError`. It never takes "the newest message". Reducer errors now carry their
  message.
- **No contract delta.**
- **Known gap:** without a key, a replay of an accepted post is a second message, and a retry after an
  ambiguous failure can duplicate. Closing it needs a `client_request_id` on `post_message` and the
  projection (a contract change), so it is left for a decision.

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test | WRITTEN — `test_post_message_persists_one_scoped_row` in `spacetimedb/tests/core/tests/chatter_post_test.rs` (`run_all_core_tests`): one scoped Comment row authored by the caller, empty model/body persist nothing, an identical body is a second distinct message, nothing appears under another organization. **Not run in this environment (no Rust build); runs in CI.** |
| A | Permission and scope; reader denied | WRITTEN — `check_permission(mail_message, create)`; reader replay asserted 403 in the spec |
| O | Playwright through the UI | WRITTEN — post from the CRM contact chatter dialog in `cov19-activity-completion.spec.ts`. **Not run in this environment.** |
| E | Resolver unit test and snapshots | Resolver unit test DONE (`mail-message-post.test.ts`, 5 tests, passing); browser assertion that exactly one message exists for the record and body WRITTEN. Stale-replay rejection is NOT asserted (see the known gap). |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
