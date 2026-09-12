# C11 operations runbook

This runbook covers application recovery before infrastructure provisioning. Never repair these failures by editing SpacetimeDB or PostgreSQL business, cursor, migration, quarantine, fence, or receipt rows manually.

## First response

1. Check `GET /live`. A failure means the API process or listener is unavailable.
2. Check `GET /ready` (the compatibility alias is `GET /health/ready`). Read the structured component states for SpacetimeDB, PostgreSQL, projection lag, contract version, migration, release compatibility, and informational AI status.
3. Preserve `X-Correlation-Id`, `X-Lumiere-Release`, the operation ID, organization ID, and the per-organization projection-status response with the incident record.
4. Run `scripts/c11-synthetic-check.sh readiness` after recovery. Use the guarded `workflows`, `isolation`, `watermark`, or `full` mode only against the disposable local topology described by each existing drill.

## Projection lag or blocked sequence

- Inspect `GET /v1/admin/organizations/<organization-id>/projection-status` as an authenticated superuser. Record the STDB head, durable sequence, oldest unprojected age, last error, and quarantined sequence.
- A transport/application failure receives bounded exponential backoff. Restore PostgreSQL or SpacetimeDB connectivity and let the same ordered sequence retry; do not advance its cursor.
- A malformed, wrong-scope, checksum-invalid, unsupported-contract, or otherwise deterministic commit is quarantined immediately. Deploy code/contracts that can safely consume that immutable commit, then restart the projection worker. Successful ordered application clears the resolved quarantine automatically.
- A missing sequence is a source-history incident. Restore the authoritative STDB source from a verified backup or use the fenced reconstruction path. Never synthesize a cursor or skip a sequence.
- Cooling remains disabled while projection is unhealthy. Confirm the status returns no error/quarantine and the durable sequence reaches the STDB head before considering recovery complete.

## PostgreSQL unavailable

- During the configured `LUMIERE_PROJECTION_LAG_BUDGET_SECS` grace, `/ready` returns `200`, reports `degraded`, and includes `X-Lumiere-Degraded: postgres`. Active STDB-backed ERP may continue, but projection and cooling must not be treated as healthy.
- Restore PostgreSQL connectivity and credentials before the grace expires. Readiness becomes `503` after the bound.
- Run `cargo run --locked -p api-server --bin storage-migrate` with the deployment's schema-administration credential. This validates checksums and applies only the append-only catalog; it must not be replaced with manual DDL or migration-row edits.
- Confirm migration and projection components are healthy, then run the readiness and watermark synthetics.

## SpacetimeDB unavailable

- `/ready`, writes, and hot reads fail closed. PostgreSQL is not a writable failover and complete-history reads must not silently become hot-only or cold-only.
- Restore the configured module endpoint and server credential. Confirm its module identity and placement generation match platform control before reopening traffic.
- Run readiness, workflow, and isolation synthetics. If durable reconstruction is necessary, follow [organization-reconstruction.md](./organization-reconstruction.md).

## Incompatible release or migration

- A contract-version, immutable contract-release, or migration-catalog mismatch makes readiness fail closed.
- Deploy a release whose `release-compatibility-manifest.json`, `lumiere-contracts` pin, STDB contract version, and PostgreSQL migration catalog agree.
- Apply migrations with the migration binary, then restart the API and workers. Do not retag a contract release, edit historical migration SQL, or alter checksums in PostgreSQL.
- Run `make check-codegen-pinned`, `make check-release-compatibility`, and the readiness synthetic before reopening traffic.

## Reconstruction

- Fence writers and confirm the server-owned placement snapshot identifies the expected cell, durable store, and generation.
- Run `cargo run --locked -p api-server --bin reconstruct-organization -- <organization-id>` with distinct reconstruction credentials. The operator supplies only the organization assertion; placement and watermark are resolved server-side.
- Resume an interrupted run with its recorded run identity. Require exact count/checksum/watermark verification before releasing the fence.
- After reconstruction, run the isolation and watermark synthetics and both golden workflows. Do not route sessions to the target before all checks pass.

## AI unavailable

AI is informational in core readiness. Ordinary ERP continues. Diagnose the AI gateway separately and do not disable STDB, PostgreSQL, projection, migration, or release checks to compensate for an AI outage.
