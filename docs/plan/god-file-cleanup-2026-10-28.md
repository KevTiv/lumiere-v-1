# God-file cleanup: 2026-10-28 verification

Base: `eeb44cf50474697da2a19f28841a74e13df6cf2c`, branch `work`.
Initial working tree: clean. Validation covered the working tree based on that
revision. No contracts, schema, dependency pins or production configuration changed.

## Implemented scope

- [Accounting ledger](module-cleanup/accounting.md): tax deadlines, groups,
  jurisdictions and schedules own their actions/mutations/row presentation;
  manual-invoice catalog selection is a typed local owner. Parent query
  activation, company selection and shared dialog lifetime stay in place.
- [Inventory ledger](module-cleanup/inventory.md): eleven cohesive tab-action
  owners retain original mutation scope, form inputs and workflow adapters.
- [API ledger](module-cleanup/api-query-execution.md): document owner queries,
  permission checks and company postfilters/order live in existing domain
  modules; literal dispatch remains available to codegen auditing. Original
  tests preserve `query_exec::tests` discovery.
- The Accounting assertion guard covers the controller and new `features/`
  directory. Its regression tests prevent an unreviewed cast from escaping by
  moving into a nested feature. Existing unrelated pages are outside that
  original review scope.
- New mounted feature tests are discovered by the existing UI Vitest command;
  the invoice-catalog suite is registered in the existing web unit command.

No generic replacement controller, shadow resource registry, broad utility
framework or new transaction owner was introduced.

## Independent review

Separate agents reviewed final production changes against the base. API public
entry points, literal resource match, permission boundary and all 37 original
root test/helper bodies preserve their logic. Document SQL retains actor/org
scope and empty-result returns. Inventory retains all 87 original actions,
184 named hook bindings and 106 original global-pending entries after expanding
feature aggregates. Accounting tax configuration/mutation and invoice selection
logic were compared for parity. Nullable selected-company inputs found during
review were repaired before acceptance checks.

## Current validation

Commands below ran on the combined working tree. Resource-limited attempts
listed afterward are excluded from passing results.

| Check | Result / scope |
| --- | --- |
| Web unit command, including registered invoice-catalog suite | 126 Node test entries passed. The catalog file contains four behavior cases; its runner reports one file entry. |
| Full shared UI Vitest suite | 185 files / 1,283 tests passed, including both new mounted feature suites. |
| Mounted Accounting/Inventory production feature hooks | 9 tests passed, including cancel/reopen, rejection, current-company rerender, large IDs and nullable selected company. These use mocked transport, not a live ERP. |
| Accounting model/record command | Eight model test entries and five invoice-record tests passed. |
| Web TypeScript | Passed with an 8 GiB Node heap after correcting new option-union/readonly interfaces and canonical row/test fixture types. |
| API query-execution tests | 98 passed, zero failed/ignored; tests use local HTTP fixtures where applicable. This is not live PostgreSQL/STDB execution. |
| API all-target check | Passed for production and test targets; existing warnings outside the changed query owners remain. |
| Canonical codegen query-dispatch audit | 10 passed, including parsing the actual current dispatcher and registry/allowlist coverage. |
| Python `scripts/tests` discovery | 172 tests passed, including four new Accounting guard regressions. |
| Structural owner guard | Passed; retired flat API owners remain absent. |
| Accounting assertion guard | Passed across original controller and extracted feature owners. |
| Opaque-record ratchet | 2,298 → 2,279 tracked occurrences; Accounting 148 → 140 and Inventory 83 → 72. Only these two baseline entries changed; new feature files have zero opaque annotations. |
| Browser operation transport / shared selects | Passed; no new transport or select owner. |
| Changed Rust formatting | `rustfmt --check` passed for changed query-execution files. |

Focused reproducible commands (from the indicated package directory):

```sh
# frontend/web
node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit
# Execute the existing test:unit and test:accounting-ui:models package scripts.

# frontend/packages/ui
node node_modules/vitest/vitest.mjs run

# frontend
node scripts/check-opaque-record-ratchet.mjs
node scripts/check-browser-operation-transport.mjs
node scripts/check-shared-selects.mjs

# repository root, with the installed Rust toolchain on PATH
cargo test --locked --offline -p api-server --lib query_exec::
cargo check --locked --offline -p api-server --all-targets
cargo test --locked --offline -p lumiere-codegen query_exec_audit
python3 -B -m unittest discover -s scripts/tests
python3 -B scripts/check-code-ownership.py
bash scripts/lint-accounting-as-unknown-as.sh
git diff --check
```

Rust compilation uses `CARGO_BUILD_JOBS=1`, `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_PROFILE_TEST_DEBUG=0`. The API build uses
the populated `.contracts-staging/bindings` inputs. Loopback fixture tests ran
outside the restricted socket sandbox; no external database was configured.

Commands use installed tools directly because this environment's fallback pnpm
tries to auto-install into an unavailable default-home location. The initial
default-heap web typecheck exhausted Node's 4 GiB heap. Simultaneous compiler
processes also exhausted the environment's 16 GiB memory limit. Verification
uses an 8 GiB Node heap, one Cargo build slot and debug-free Rust test builds;
failed resource-limited attempts are not counted as passes.

## Historical evidence reconciliation

The September corrective log's absent-runtime-evidence statements describe that
checkpoint. They must not be copied as a repository-wide current finding:

- [September 6 reconstruction drill](../evidence/c7-reconstruction-drill-2026-09-06.json)
  records disposable all-module restore, interruption/resume and fresh repeat,
  checksums, identity/tenant isolation and workflow continuation.
- [BASE-05 pretenant record](erp-base05-pretenant-integrated-status.md) records
  September 24 CI pretenant 27 passed/17 prerequisite skips and P0 89 passed/9
  prerequisite skips.
- [October runtime acceptance](../evidence/cov-runtime-docker-acceptance-2026-10-04.md)
  records two 46-browser runs, projection convergence and the October 7 C4
  released-migration compatibility closure.

Those records are historical baselines; none certify today's patch. Ordinary
unit tests can bypass PostgreSQL tests unless their explicit environment gates
are enabled. Mocked hook tests do not certify live authorization, persisted
effects, real controller browser behavior or production readiness.

## Remaining work

This bounded source-extraction batch passes its compilation, unit, mounted
interaction, ownership and dispatch-audit checks. It is ready for review.

The module ledgers identify the next bounded extractions. Accounting and
Inventory still contain substantial record-form, query and composition code.
Wider session-extractor adoption, realtime cleanup and stub-policy choices
retain separate owners and behavior-sensitive acceptance gates. M90/D90 remain
partial until the declared combined-tree service-backed acceptance is complete;
this pass does not mark all modules or the entire cleanup program finished.
