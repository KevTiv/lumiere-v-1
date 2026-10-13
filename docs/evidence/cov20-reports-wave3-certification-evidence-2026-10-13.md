# COV-20 Reports Wave 3 certification evidence (2026-10-13)

## Closed contracts

- Stored bar and donut categories resolve through a versioned, allowlisted drill-target contract. Persisted model/field values cannot inject arbitrary routes; unsupported definitions remain non-interactive.
- Reports runtime pushes admitted drill targets to the canonical module/tab/filter URL.
- Stored-widget CSV exports embed `lumiere.report-export-provenance/v1` as the first machine-readable line, including organization, company, dashboard, widget, model, domain, grouping, and bounded time range.
- Stored-widget and dashboard PNG exports download a JSON provenance sidecar containing the same source snapshot plus artifact filename, MIME type, export timestamp, and SHA-256 digest of the exact PNG bytes.
- Browser coverage submits a direct dashboard-widget API request with an out-of-organization company scope and a unique request key, asserts `403`/`422`, and proves no matching row was persisted.
- Browser coverage downloads and parses provenance from the actual operator CSV action, then clicks a rendered report category and asserts canonical Sales navigation.

## Verification

- UI focused Vitest: **23 passed** across drill-target, resolver, CSV, and provenance suites.
- UI TypeScript: `tsc -p frontend/packages/ui/tsconfig.json --noEmit` passed.
- Playwright discovery: COV-26 Reports source-quality spec discovered successfully (7 authenticated tests plus setup).
- Web TypeScript was started and stopped after 30 seconds without diagnostics to avoid monopolizing the shared certification workspace; central integration should run the complete web check.

## Runtime prerequisite

The expanded COV-26 operator test requires the normal first-organization fixture and live web/API/SpacetimeDB stack. This lane performed discovery only; it did not claim a live browser pass.
