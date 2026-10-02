# COV-22 — Publish one form configuration; validate→commit one import

**Status:** IMPLEMENTED — payslip import commit idempotent by content and form publish version-checked and read back (contract release and runtime acceptance pending)  
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

**Contract release required (registry projection only).** `form-configs` now also projects `updated_at`, the compare-and-set token for publishing over an existing configuration (see Implementation). The import identity needs no contract change.



## Implementation

**Import commit (idempotent by content).** `import_hr_payslip_csv` was not idempotent: it had no file
identity, so a retry or replay inserted every payslip again, and a file whose every row was rejected still
reported success to the operator.
- `import_content_sha256` (`spacetimedb/src/data_ops/import_tracker.rs`) is SHA-256 over the table name, a
  newline and the CSV with a leading BOM removed, CRLF normalized to LF and surrounding ASCII whitespace
  trimmed. The job records it as `{"content_sha256": …}` in `import_job.metadata`.
- `import_hr_payslip_csv` returns without writing when `find_committed_import` finds a job in the
  organization for the same table and content that imported rows and was not rolled back. A job that
  imported nothing, or was rolled back, does not block a retry. Other import reducers are unchanged.
- `useImportHrPayslipCsv` (`frontend/packages/query-hooks/src/hooks/hr/imports.ts`) derives the same identity
  in the browser (`importContentSha256`, Web Crypto; a shared test vector pins both sides), reads
  `/api/query/import-jobs` back and resolves the one job that committed it
  (`resolveCommittedImportJob`, `import-job-effect.ts`). Two committing jobs for one content throw
  `AmbiguousOperationEffectError`; a file that committed nothing now fails in the modal instead of closing.

**Form publish (compare-and-set and exact readback).** `publish_form_configuration` (`spacetimedb/src/forms/mod.rs`)
only rejected a stale publish when `expected_updated_at_micros` was sent, and nothing sent it: a replay of an
accepted publish re-published and bumped `config_version`. Publishing over an existing configuration now
requires `expected_updated_at_micros` equal to its current `updated_at`; without it the reducer rejects with
`form configuration already exists (version N); pass expected_updated_at_micros to update it`, and a stale value
is rejected as a concurrent modification. A first publish is unchanged.
- **Contract change:** `form-configs` now also projects `updated_at` (registry only) so the client can read the
  compare-and-set token; the release is published automatically on push.
- `pushRegistryFormToDatabase`
  (`frontend/packages/ui/src/forms/utils/push-registry-form.ts`, the only caller of
  `publish_form_configuration`) reads `form-configs` first, sends the row's `updated_at` as
  `expectedUpdatedAtMicros` when one exists (`formConfigUpdatedAtMicros`), and requires the exact
  (organization, module, form) row to read back active at the previous `config_version` plus one (1 for a first
  publish) via `resolvePublishedFormConfig` (`form-config-publish.ts`); any other version is reported as a
  concurrent publish.
- **Behaviour change to note:** an external client that republishes an existing form without
  `expected_updated_at_micros` is now rejected. In this repository the only caller is the settings button above
  (shown only while no configuration exists) and the platform smoke tests (first publishes); no other caller was found.

## Prerequisites / decisions

BASE-04 (statement import identity) landed; it does not cover HR imports, so the payslip import identity is added here.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN for the import — `test_payslip_csv_import_is_idempotent_by_content` in `spacetimedb/tests/hr/wave_a_test.rs` (registered in `run_hr_wave_a_test`): one job and one payslip after a replay, a CRLF variant and a trailing-whitespace variant; changed content imports as its own job; two all-rejected imports are two failed jobs that do not block a retry; shared SHA-256 vector. **Not run in this environment (no Rust build); runs in CI.** Form publish: `test_publish_form_configuration_requires_expected_version` in `spacetimedb/tests/platform/platform_smoke.rs` (called from the existing `run_forms_custom_field_test`): a replay without the token and a stale token are rejected with the version unchanged, the current token updates once to version 2. |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(hr_payroll, create)` and `form_configuration` create/update (checked before the version check, so a reader gets 403, not 422); reader replays of both asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — Settings → Forms "create from registry" and HR → Payslips CSV import (first upload, CRLF re-upload, changed content, an all-rejected file) in `frontend/web/tests/e2e/cov22-form-publish-import-commit.spec.ts`. The form test skips when every candidate CRM form is already published. **Spec not run in this environment; runs in CI.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Resolver unit tests DONE (`import-job-effect.test.ts` 7 tests, `form-config-publish.test.ts` 6 tests, passing); browser assertions WRITTEN. An import replay is an idempotent success (not 422), so the spec asserts the job and payslip snapshots are unchanged; a form-publish replay returns 422 with the version unchanged. |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
