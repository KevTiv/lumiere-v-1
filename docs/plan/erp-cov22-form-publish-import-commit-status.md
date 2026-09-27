# COV-22 — Publish one form configuration; validate→commit one import

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Imports / Forms  
**Plan target:** validate, preview and idempotently commit one import  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: embedded surfaces (no standalone route)

Existing operations (already reachable from the frontend command layer):

- `publish_form_configuration` — hook: none found
- `import_hr_payslip_csv` — hook: `frontend/packages/query-hooks/src/hooks/hr/imports.ts`

Canonical resources: form-configs, payslips

## Effect contract

Published form reads back the incremented `config_version`; import commit is idempotent by file hash.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none for form publish (`form-configs` exposes config_version, is_active); import idempotency proof depends on BASE-04's SHA-256 import identity



## Prerequisites / decisions

BASE-04 landed.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov22-form-publish-import-commit.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
