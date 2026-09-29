# COV-14 — Ticket assign → close → reopen

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov14-helpdesk-ticket-lifecycle`  
**Stack base:** `codex/cov13-pos-session-close`  
**Module/surface:** Helpdesk  
**Plan target:** assign, close and reopen one ticket

## Bounded path

Operator surface: `/helpdesk` → Tickets.

The browser proof:

1. creates one ticket through the visible Helpdesk form;
2. seeds only the required current-user contact/team-membership relation;
3. assigns that ticket through the visible ticket detail dialog;
4. closes it through the visible table action;
5. reopens it through the visible table action;
6. after each accepted transition, reads back the same ticket by primary key;
7. replays every accepted request and requires stale rejection with the exact
   snapshot unchanged;
8. replays all three requests as `fixture.reader@example.test` and requires
   HTTP 403 with the canonical ticket unchanged.

## Domain correction

Source review found that the three reducers were not replay-safe:

- assigning the same agent again rewrote/audited the same state;
- `close_ticket` could be called repeatedly and replace `closed_at`;
- `reopen_ticket` could be called repeatedly even when the ticket was already
  open/in progress.

COV-14 adds narrow state guards:

- exact same-agent assignment while already `InProgress` is rejected;
- assignment to a *different* valid team member remains allowed;
- closing an already-Closed ticket is rejected;
- reopen is allowed from `Closed` or `Cancelled` only, preserving the UI's
  existing Cancelled → InProgress path;
- replay after successful reopen is rejected.

## Exact effect contract

The existing ticket table already carries organization scope. The read
projection now additionally exposes the existing fields:

- `user_id`;
- `closed_at`.

`resolveHelpdeskTicketLifecycleEffect` requires:

- exactly one ticket with the requested primary key;
- matching `organization_id`;
- assignment: `InProgress`, exact assignee identity and no `closed_at`;
- close: `Closed` with a persisted `closed_at`;
- reopen: `InProgress` with `closed_at` cleared.

Duplicate exact identities fail closed. No newest-ticket, name or timestamp
correlation is used.

Assignment and close allow pre-dispatch exact-effect reconciliation for
lost-response recovery. Reopen intentionally uses
`resolveBeforeDispatch: false`, because an unrelated already-InProgress
ticket is not proof that this reopen invocation previously succeeded.

## Contract disposition

**Contract release required and triggered.**

Changed `helpdesk-tickets` projection only:

- expose existing `user_id`;
- expose existing `closed_at`.

No table, reducer signature or new business field was added.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | Existing Helpdesk relational-integrity suite now includes `test_ticket_lifecycle_is_exact_and_replay_safe`: valid team assignment, same-agent replay rejection, cross-org close rejection, close replay preservation, reopen preservation and stale reopen rejection. | `run_all_helpdesk_tests` passes. |
| A | Existing operations keep `helpdesk_ticket:update` permission and organization guards; assignment also retains known-contact + team-membership checks. Browser reader replay requires 403 for assign/close/reopen. | Authorized actor succeeds; reader/cross-org attempts leave the same ticket unchanged. |
| O | `cov14-helpdesk-ticket-lifecycle.spec.ts` visibly creates and assigns through the ticket dialog, then closes and reopens through Helpdesk row actions. | Focused Playwright proof passes. |
| E | `helpdesk-lifecycle-effect.test.ts` covers exact scope/state/assignee/closed-at/ambiguity; browser proof preserves exact snapshots after each stale 422 and reader 403. | Query-hook unit/native/browser evidence green on one head. |

## Acceptance

COV-14 becomes **ACCEPTED** only when the same branch head records:

1. automatic contracts release/pin with `user_id` and `closed_at` in the
   `helpdesk-tickets` projection;
2. query-hooks typecheck + unit tests;
3. `run_all_helpdesk_tests` on a live stack;
4. focused COV-14 Playwright proof;
5. branch CI green.

Until then the truthful disposition is **IMPLEMENTED — runtime acceptance
pending**.
