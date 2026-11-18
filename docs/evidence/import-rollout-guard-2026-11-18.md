# Import rollout guard (AIH-37) - evidence, 2026-11-18

## Findings
- This draft originally split #444's migration 51 and claimed 52 for the contract step. That plan is superseded by the merged catalog: `main` retains #444's original 51 (which already dropped the old five-column constraint) and #447 owns 52 (`ai_index_job`). Rewriting 51 or reassigning 52 could invalidate a database's migration history.
- The reconciled PR leaves migrations 51 and 52, their checksums, and the `0.3.185` contracts pin unchanged. It ships the import rollout guard without a new migration or a staging state for a split that is no longer possible.

## Done
- `rollout_guard.rs`: `LUMIERE_IMPORTS_PAUSED` flag (unknown values pause) and a startup/10s-cached comparison of the compiled catalog version with the database's max applied version; both return 503 `{error: "Imports are paused for an update", code}` with codes `imports_paused` / `import_writer_schema_mismatch`.
- Frontend: `import-write-pause.ts` (+ test), `module-backfill-action.tsx` shows the paused message and keeps the task retryable; i18n keys `settings.importTask.importsPaused*` in en/fr/rw (rw-x-en has no importTask keys from #444, so none added).
- Release script and workflow: `set-import-pause` uses a scoped Railway patch, waits for a new successful API deployment, and reads the applied setting back. An already-configured value still requires a fresh deploy. `verify-catalog` requires a ready response with both the applied and expected versions matching before the workflow resumes imports. An unset `RAILWAY_API_READINESS_URL` stops the release before any mutation.
- Regenerated the alpha-history inventory after the import-review module changed, fixing the stale-inventory check on this PR.
- Follow-up CI fixes: the frontend job timed out installing Chromium on an EC2 regional Ubuntu mirror, and Semantic Index Q0's frontend job could not install `ripgrep` on `ubuntu-latest` (26.04). The browser jobs now share the HTTPS archive installer, and Semantic Index Q0 uses Ubuntu 24.04, matching the main Rust and frontend test jobs.

## Validated
- Rust 1.100.0: verified the vendored contracts first, then passed `cargo check --locked -p api-server --tests`. With `C4_TEST_PG=1` and local PostgreSQL 15.20, the migration unit tests (23), PostgreSQL compatibility tests (18), and import-review suite (73) passed. The compatibility job in GitHub Actions uses PostgreSQL 18.
- Reviewed the pinned Railway CLI v5.67.1 source: piped JSON is deserialized as `EnvironmentConfig`, with variables at `services.<service-id>.variables.<key>.value` and values typed as strings. `bash scripts/tests/test-railway-stack-release.sh`, `bash -n`, and `actionlint` passed. The shell tests use mocked Railway and HTTP responses, including failed deploys, failed config reads, and stale catalog reports.
- Node 26.13.1: `import-write-pause.test.ts` passed 3/3, `pnpm --dir frontend i18n:check` passed, and web and UI `tsc --noEmit` passed. The web typecheck needed `NODE_OPTIONS=--max-old-space-size=8192` after the default heap limit was exhausted. The release manifest and alpha-history inventory checks passed.
- `actionlint` passed for the changed CI workflows. A local installer fixture confirmed that Azure and EC2 archive entries are rewritten, the security archive is preserved, and the pinned Playwright install is still called. The fixture did not download Chromium or exercise a hosted runner.

## First rollout gates

- The live pre-guard binary does not honor `LUMIERE_IMPORTS_PAUSED`. Before the first guarded rollout, use a maintenance window to stop Sales and Warehouse import writes independently of this flag and let in-flight writes drain. Verify the real pause/resume path in a non-production Railway environment before relying on it.
- Check the target migration history against the retained catalog before rollout; production state was not inspected. A disposable database that ran the abandoned draft split cannot migrate directly to this catalog. Do not reset a durable database or edit applied checksums. Do not roll a writer that requires the old five-column conflict target back over the schema after migration 51.

## Remaining
- [ ] Get CI green on the updated PR and confirm the Railway edit, deployment and readiness checks live in a non-production environment. No Railway mutation or production check was run in the Cloud Runner.
- [ ] Chat card (`import-task-status-card.tsx`) paused display if wanted beyond the execution panel

## Signed-in pilot checklist (Kevin)
- [ ] After release, with pause off, import the Shop Sales workbook through chat
- [ ] Preview accepts rows on different worksheets that share a row number
- [ ] Saved total equals RWF 71,406,345.45
- [ ] Re-import the same file: all rows matched, none duplicated
- [ ] Set `LUMIERE_IMPORTS_PAUSED=true` on a non-production deploy: card shows the paused message and resumes after
