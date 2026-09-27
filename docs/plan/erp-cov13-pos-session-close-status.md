# COV-13 — Session order/payment → close

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** POS  
**Plan target:** one session order, payment and close  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /pos

Existing operations (already reachable from the frontend command layer):

- `close_pos_session` — hook: `frontend/packages/query-hooks/src/hooks/pos.ts`

Canonical resources: pos-sessions, pos-configs

## Effect contract

Same session id reads back `state` = closed; company scope derives through config_id → pos-configs.company_id.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** `pos-sessions` has neither organization_id nor company_id in its projection (the table has no company column); exact scoped readback needs the config/company relation exposed or a join-backed resource

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Stock/accounting convergence proof depends on COV-06/08 acceptance.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov13-pos-session-close.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
