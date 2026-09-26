# COV-20 — Configure → execute → export one scheduled report

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Reports / Analytics  
**Plan target:** configure, execute, drill and export one report  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /reports

Existing operations (already reachable from the frontend command layer):

- `create_scheduled_report` — hook: `frontend/packages/query-hooks/src/hooks/reports.ts`
- `record_report_run` — hook: `frontend/packages/query-hooks/src/hooks/reports.ts`

Canonical resources: scheduled-reports

## Effect contract

Run effect resolves by (report id, run_count/last_run) — deterministic totals checked against the source query.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** `scheduled-reports` exposes neither last_run nor run_count and there is no report-run resource

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Deterministic dataset fixture.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov20-report-run.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
