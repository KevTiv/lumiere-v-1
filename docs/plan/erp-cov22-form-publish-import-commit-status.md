# COV-22 — Publish one form configuration; validate→commit one import

**Status:** IMPLEMENTED — exact publish/import readback + hash-idempotent payslip import; runtime acceptance pending  
**Module/surface:** Imports / Forms  
**Plan target:** validate, preview and idempotently commit one import  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: embedded surfaces (no standalone route)

Existing operations (already reachable from the frontend command layer):

- `publish_form_configuration` — hook: none found
- `import_hr_payslip_csv` — hook: `frontend/packages/query-hooks/src/hooks/hr/imports.ts`

Canonical resources: `form-configs`, `import-jobs` (payslips are the imported rows)

## Effect contract

Published form reads back the incremented `config_version`; import commit is idempotent by file hash.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta.** `import_hr_payslip_csv` keeps its signature; `form-configs` already exposes
`config_version` / `is_active` and `import-jobs` exposes `metadata`. BASE-04's SHA-256 identity was
client-side for bank statements only, so the payslip import now derives it server-side.

## Slice 1 — implemented

- **Domain (import):** `import_hr_payslip_csv` hashes the received CSV (SHA-256, lowercase hex), stamps
  the `ImportJob.metadata` as `{"sha256":"…"}`, and rejects a file whose hash already has a `success` or
  `partial` job for the same organization + `hr_payslip` (`import_tracker.rs`:
  `reject_committed_import_replay`). A fully `failed` job does not burn its identity, so a corrected retry
  works; a changed file or another organization imports normally. No schema change.
- **Domain (form):** unchanged — `publish_form_configuration` already bumps `config_version` and rejects a
  stale `expected_updated_at_micros`.
- **Hooks:** `pushRegistryFormToDatabase` reads `form-configs` before and after and proves the exact
  (org, module, form) is active at `prior + 1`; `useImportHrPayslipCsv` hashes the file client-side and
  proves the exact hash-stamped `import-jobs` row (`form-import-effect.ts`). Duplicates raise
  `AmbiguousOperationEffectError`; a missing readback is an error, not a success.
- **UI:** unchanged — Settings → Form config "create from registry" and the HR payslips CSV import dialog.
- **Semantics note:** the form's UI push only exists before a form is first published, so the UI proves
  `config_version` 1; the stale replay uses `expected_updated_at_micros = 1` (the query API returns ISO
  timestamps, so the exact micros token is not derived client-side). The spec skips when `crm/new-lead`
  is already published in the target org.

## Prerequisites / decisions

BASE-04 landed (accepted 2026-09-24).

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN — `tests/data_ops/import_idempotency_test.rs` (via `run_data_ops_commit_test`): replay rejected with payslips/jobs unchanged, changed file imports, per-org identity, failed import retryable; PASSED on a scratch local db via `run_data_ops_commit_test` |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — reader replay asserted 403 for both paths in the spec; not yet run |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — `frontend/web/tests/e2e/cov22-form-publish-import-commit.spec.ts`; typechecks and lists, not yet run against a seeded stack |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE (resolvers) — `form-import-effect.test.ts` (9 pass); snapshot assertions written in the spec |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
