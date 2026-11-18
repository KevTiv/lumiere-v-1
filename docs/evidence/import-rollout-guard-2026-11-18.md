# Import rollout guard (AIH-37) - evidence, 2026-11-18

## Findings
- Migration 51 (#444, fcde3069) was never released: CI failed on fcde3069 and 05dd919 (Playwright install timeout), the last production deploy was 6c316493, and the release-main run for fcde3069 was skipped. 51 therefore has no recorded checksum in production, so its SQL was edited in place. A local or ad hoc database that already applied the old 51 will fail the checksum check and must be reset.
- The catalog checks checksums per migration and rejects a database that holds a later `contract` migration, so rolling the binary back past 52 fails closed by design.

## Done
- 51 (Expand) keeps the five-column unique constraint; 52 `module_backfill_provenance_contract` (Contract, change set 40) drops it.
- Manifest: catalog version 52, checksum `sha256:0719c706...eab8`. The cargo example could not be run here (contracts crate OOM), so the value was computed with a script that reimplements `migration_catalog_checksum`; it reproduces the pinned test values for the first 30 migrations and the previous manifest value for 51. CI's `release_manifest_binds_complete_application_migration_catalog` test is the authority.
- Writer: a row whose worksheet differs but shares a row number with a saved row, while the old constraint exists, is held with code `schema_contract_pending` (preview and save) instead of a 409/500.
- `rollout_guard.rs`: `LUMIERE_IMPORTS_PAUSED` flag (unknown values pause) and a startup/10s-cached comparison of the compiled catalog version with the database's max applied version; both return 503 `{error: "Imports are paused for an update", code}` with codes `imports_paused` / `import_writer_schema_mismatch`.
- Frontend: `import-write-pause.ts` (+ test), `module-backfill-action.tsx` shows the paused message and keeps the task retryable; i18n keys `settings.importTask.importsPaused*` in en/fr/rw (rw-x-en has no importTask keys from #444, so none added).
- Release script and workflow: `set-import-pause`, `verify-catalog`; pause on before storage migration, off only after the served catalog matches; failure leaves it on.

## Validated
- Node 22: `import-write-pause.test.ts` 3/3, `pnpm i18n:check` passes, `verify-release-manifest.py` and its tests pass. rustfmt applied.
## NOT validated
- No Rust compiled or tested (OOM). Postgres tests (`C4_TEST_PG=1`) not run; `exercise_persistence` was updated to cover both constraint states.
- Railway variable patch shape (`services.<id>.variables.<KEY>.value`) is unverified; the first run of the pause step needs a dry check. The pre-guard binary cannot honour the flag.
- tsc was not confirmed; shell scripts only syntax-checked (`bash -n`).

## Remaining
- [ ] CI compile and test fixes; run postgres tests
- [ ] Add shell test for new script commands in `scripts/tests/test-railway-stack-release.sh`
- [ ] Chat card (`import-task-status-card.tsx`) paused display if wanted beyond the execution panel
- [ ] Bump migration numbering if AIH-30 adds one first (recompute checksum)

## Signed-in pilot checklist (Kevin)
- [ ] After release, with pause off, import the Shop Sales workbook through chat
- [ ] Preview shows no `schema_contract_pending` holds once 52 is applied
- [ ] Saved total equals RWF 71,406,345.45
- [ ] Re-import the same file: all rows matched, none duplicated
- [ ] Set `LUMIERE_IMPORTS_PAUSED=true` on a non-production deploy: card shows the paused message and resumes after
