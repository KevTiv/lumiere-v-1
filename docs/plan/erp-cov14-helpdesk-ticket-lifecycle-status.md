# COV-14 — Ticket assign → close → reopen

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Helpdesk  
**Plan target:** assign, resolve, close and reopen one ticket  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /helpdesk

Existing operations (already reachable from the frontend command layer):

- `assign_ticket` — hook: `frontend/packages/query-hooks/src/hooks/helpdesk.ts`
- `close_ticket` — hook: `frontend/packages/query-hooks/src/hooks/helpdesk.ts`
- `reopen_ticket` — hook: `frontend/packages/query-hooks/src/hooks/helpdesk.ts`

Canonical resources: helpdesk-tickets

## Effect contract

Same ticket id reads back `state` (close/reopen). Assignment needs the assignee field.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** `helpdesk-tickets` exposes state but not the assignee (user_id); close/reopen need none. Table has no company_id — scope is organization-only

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Role visibility fixture for agent vs reader.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov14-helpdesk-ticket-lifecycle.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
