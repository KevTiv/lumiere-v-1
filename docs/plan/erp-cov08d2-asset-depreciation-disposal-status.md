# COV-08d2 — Fixed-asset depreciation board and disposal exact effects

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Accounting / Assets  
**Plan target:** COV-08 assets  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /accounting → Fixed assets

Existing operations (already reachable from the frontend command layer):

- `compute_depreciation_board` — hook: `frontend/packages/query-hooks/src/hooks/accounting/assets.ts`
- `dispose_account_asset` — hook: `frontend/packages/query-hooks/src/hooks/accounting/assets.ts`

Canonical resources: account-assets, depreciation-lines

## Effect contract

Depreciation: the exact set of `depreciation-lines` rows for the asset id (0..N, replay must not duplicate). Disposal: same asset id reads back `Removed`.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release possibly required.** state-only disposal readback (`account-assets.state` = Removed) and depreciation lines (`depreciation-lines` by asset_id) need no release; proving the disposal journal move identity needs the asset→move relation exposed on `account-assets`

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Stack on #103 (COV-08d confirm/close).

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov08d2-asset-depreciation-disposal.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
