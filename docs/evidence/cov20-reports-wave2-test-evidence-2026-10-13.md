# COV-20 Reports / Analytics Wave 2 test evidence — 2026-10-13

## Scope

This wave adds focused automated checks for truthful source states, recovery,
large inputs, company scope, and export fidelity. It does not promote Reports to
U5: drill-through and end-to-end export provenance still have architecture gaps
listed below.

## Added proof

| Requirement | Automated evidence | Disposition |
| --- | --- | --- |
| Empty versus loading | `cov26-reports-source-quality.spec.ts` holds the source response, asserts loading, then returns an empty successful result | Covered |
| Dependency error / denial | The same spec asserts distinct 503 and 403 alert states and no false row-count success | Covered |
| Reconnect | The same spec aborts the first source request as disconnected, retries from the visible control, and proves one current row with the stale error removed | Covered |
| Large data | `stored-dashboard-resolver.test.ts` resolves 5,000 rows into 250 groups, proves exact totals/order, and enforces the persisted 25-row limit | Covered at resolver boundary |
| Company scope | `cov26-reports-source-quality.spec.ts` supplies current- and foreign-company saved definitions and proves only the active-company definition is selectable | Covered at operator boundary |
| Export fidelity | `export-csv.test.ts` proves deterministic 1,000-row output and correct escaping of provenance-bearing labels/values | Covered at serializer boundary |
| Malformed stored definition | Existing source-quality browser coverage renders the persisted unsupported operator as a diagnostic rather than a misleading chart | Covered |

## Remaining U5 blockers

- Stored report widgets contain rendered values but no canonical record identity
  or module/tab target. Consequently a chart segment cannot perform a provable
  record drill-through. Add a typed drill target/filter contract to the stored
  widget definition and prove navigation to the exact filtered source records.
- Dashboard CSV exports currently contain the rendered headers and values only.
  They do not embed source report id, saved definition id/version, company id,
  generation time, or filter snapshot. Pivot XLSX filenames include report and
  definition ids and the UI shows company provenance, but the downloaded
  artifact has no machine-verifiable provenance manifest.
- The large-data proof is deterministic in-process coverage. A same-head browser
  acceptance run against a production-sized server projection is still required
  to establish latency and memory bounds.
- Company filtering is proven for saved definitions in the Pivot Explorer. The
  API still needs same-head adversarial certification that a foreign-company
  financial report and its trial-balance rows cannot be queried directly.

## Commands

Run focused unit coverage:

```sh
pnpm --dir frontend/packages/ui vitest run src/lib/stored-dashboard-resolver.test.ts src/lib/export-csv.test.ts
```

Run browser coverage against the seeded stack:

```sh
pnpm --dir frontend/web playwright test tests/e2e/cov26-reports-source-quality.spec.ts
```

## Validation recorded on this change

- Focused UI tests: **17 passed** across
  `stored-dashboard-resolver.test.ts` and `export-csv.test.ts`.
- Playwright discovery: **8 tests listed**, including both new browser cases.
- Browser execution: blocked before test execution because the configured web
  server exited with status 1 in the shared workspace. No browser pass is
  claimed by this document.
