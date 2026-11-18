# Import rollout guard (AIH-37) - evidence, 2026-11-18

## Findings
- Migration 51 (#444, fcde3069) was never released: CI failed on fcde3069 and 05dd919 (Playwright install timeout), the last production deploy was 6c316493, and the release-main run for fcde3069 was skipped. 51 therefore has no recorded checksum in production, so its SQL was edited in place. A local or ad hoc database that already applied the old 51 will fail the checksum check and must be reset.
- The catalog checks checksums per migration and rejects a database that holds a later `contract` migration, so rolling the binary back past 52 fails closed by design.

## Done
- 51 (Expand) keeps the five-column unique constraint; 52 `module_backfill_provenance_contract` (Contract, change set 40) drops it.
- Manifest: catalog version 52, checksum `sha256:0719c706...eab8`. The value computed in the initial pass was confirmed by `release_manifest_binds_complete_application_migration_catalog` in the Cloud Runner.
- Writer: a row whose worksheet differs but shares a row number with a saved row, while the old constraint exists, is held with code `schema_contract_pending` (preview and save) instead of a 409/500.
- `rollout_guard.rs`: `LUMIERE_IMPORTS_PAUSED` flag (unknown values pause) and a startup/10s-cached comparison of the compiled catalog version with the database's max applied version; both return 503 `{error: "Imports are paused for an update", code}` with codes `imports_paused` / `import_writer_schema_mismatch`.
- Frontend: `import-write-pause.ts` (+ test), `module-backfill-action.tsx` shows the paused message and keeps the task retryable; i18n keys `settings.importTask.importsPaused*` in en/fr/rw (rw-x-en has no importTask keys from #444, so none added).
- Release script and workflow: `set-import-pause` uses a scoped Railway patch, waits for a new successful API deployment, and reads the applied setting back. An already-configured value still requires a fresh deploy. `verify-catalog` requires a ready response with both the applied and expected versions matching before the workflow resumes imports. An unset `RAILWAY_API_READINESS_URL` stops the release before any mutation.
- Regenerated the alpha-history inventory after the import-review module changed, fixing the stale-inventory check on this PR.

## Validated
- Rust 1.100.0: verified the vendored contracts first, then passed `cargo check --locked -p api-server --tests`. With `C4_TEST_PG=1` and local PostgreSQL 15.20, the migration unit tests (23), PostgreSQL compatibility tests (18), and import-review suite (73) passed. The compatibility job in GitHub Actions uses PostgreSQL 18.
- Reviewed the pinned Railway CLI v5.67.1 source: piped JSON is deserialized as `EnvironmentConfig`, with variables at `services.<service-id>.variables.<key>.value` and values typed as strings. `bash scripts/tests/test-railway-stack-release.sh`, `bash -n`, and `actionlint` passed. The shell tests use mocked Railway and HTTP responses, including failed deploys, failed config reads, and stale catalog reports.
- Node 26.13.1: `import-write-pause.test.ts` passed 3/3, `pnpm --dir frontend i18n:check` passed, and web and UI `tsc --noEmit` passed. The web typecheck needed `NODE_OPTIONS=--max-old-space-size=8192` after the default heap limit was exhausted. The release manifest and alpha-history inventory checks passed.

## First rollout gates

- The live pre-guard binary does not honor `LUMIERE_IMPORTS_PAUSED`. Before the first production migration, use a maintenance window to stop Sales and Warehouse import writes independently of this flag and let in-flight writes drain. Verify the real pause/resume path in a non-production Railway environment before relying on it.
- Earlier merges can trigger `Release main to Railway` and apply the original 51. Keep that production rollout on hold until the guarded revision is the one being released. Check the target migration history again before applying the edited 51; if the old checksum is present in production, stop and plan a forward migration rather than resetting the database.
- The migration runner applies pending migrations 51 and 52 in one transaction. The release checks the final catalog; this is not a separately deployed or independently signed-off expand-only release.

## Remaining
- [ ] Get CI green on the updated PR and confirm the Railway edit, deployment and readiness checks live in a non-production environment. No Railway mutation or production check was run in the Cloud Runner.
- [ ] Chat card (`import-task-status-card.tsx`) paused display if wanted beyond the execution panel
- [ ] Rebase AIH-30 after AIH-37 and renumber the index migration to 53

## Signed-in pilot checklist (Kevin)
- [ ] After release, with pause off, import the Shop Sales workbook through chat
- [ ] Preview shows no `schema_contract_pending` holds once 52 is applied
- [ ] Saved total equals RWF 71,406,345.45
- [ ] Re-import the same file: all rows matched, none duplicated
- [ ] Set `LUMIERE_IMPORTS_PAUSED=true` on a non-production deploy: card shows the paused message and resumes after
