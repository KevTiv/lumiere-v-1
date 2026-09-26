# COV-19 — Record-linked activity completion (then message post)

**Status:** SCAFFOLDED — implementation pending  
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

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov19-activity-completion.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
