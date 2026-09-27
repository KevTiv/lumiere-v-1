# COV-08e — Finance module certification over 08a–d

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Accounting / Finance  
**Plan target:** COV-08 certification  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /accounting, /reports

Existing operations (already reachable from the frontend command layer):

- `archive_financial_report` — hook: `frontend/packages/query-hooks/src/hooks/reports.ts`

Canonical resources: financial-reports, account-moves, account-periods, account-assets

## Effect contract

Certification slice: re-runs the 08a–d proofs on one seeded company and adds one financial-report state readback (`financial-reports.state`).

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `financial-reports` exposes id, organization_id, company_id, state



## Prerequisites / decisions

08a–d accepted; contracts v0.3.55 for 08b/COV-05 registry changes.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov08e-finance-certification.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
