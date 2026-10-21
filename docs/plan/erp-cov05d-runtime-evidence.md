# COV-05d runtime acceptance evidence and integrated rerun

## Integrated result

**REVIEW — all four local operator gates passed; full Purchasing certification is not claimed.**

Validated source: base `98b51190ccfa2c7a7238f9e80c4049550defcbbe` plus the
COV-05d working-tree snapshot before publication. Exact production/test file hashes are recorded in
[`../evidence/cov05d-source-fingerprint.json`](../evidence/cov05d-source-fingerprint.json).
The relevant-source manifest SHA-256 is
`f9a31bc456139b064208639aa4c7e9950b9dfc7960ac539f155d2cd772e4d70f`.
This is local runtime evidence, not a same-head remote CI result.

| Gate | Dedicated PostgreSQL / STDB module | Final browser result | Log under `.tmp/e2e/cov05d-run-20261011212115/` |
| --- | --- | --- | --- |
| COV-05a | `lumiere_cov05a_20261011212115_final` / `lumiere-cov05a-20261011212115-final` | 1 passed (19.8s) | `cov05a-fresh-final.log` |
| COV-05b | `lumiere_cov05b_20261011212115_final` / `lumiere-cov05b-20261011212115-final` | 1 passed (23.1s) | `cov05b-fresh-final.log` |
| COV-05c | `lumiere_cov05c_20261011212115` / `lumiere-cov05c-20261011212115` | 1 passed (23.8s) | `cov05c.log` |
| COV-05d | `lumiere_cov05d_20261011212115` / `lumiere-cov05d-20261011212115` | 1 passed (21.0s) | `cov05d-final.log` |

All four setups exited 0 and logged passing core and configured domain reducer
tests, fixture/persona seeding, storage migrations, and API readiness.
The browser targets built and started the actual Next.js production app.
Setup's optional inventory/analytics aggregates were not requested.

### Actual gate commands

The documented commands were used with explicit fresh-name substitutions.
The original `lumiere_cov05_e2e` database was already present and was not touched.
Each browser command below also invokes setup through the Makefile dependency:

```bash
PG_DATABASE=lumiere_cov05a_20261011212115_final make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05a-20261011212115-final
PG_DATABASE=lumiere_cov05a_20261011212115_final make e2e-single E2E_SPEC=cov05-purchase-order-confirmation.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05a-20261011212115-final
PG_DATABASE=lumiere_cov05b_20261011212115_final make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05b-20261011212115-final
PG_DATABASE=lumiere_cov05b_20261011212115_final make e2e-single E2E_SPEC=cov05b-purchase-receipt.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05b-20261011212115-final
PG_DATABASE=lumiere_cov05c_20261011212115 make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05c-20261011212115
PG_DATABASE=lumiere_cov05c_20261011212115 make e2e-single E2E_SPEC=cov05c-vendor-bill.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05c-20261011212115
PG_DATABASE=lumiere_cov05d_20261011212115 make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05d-20261011212115
PG_DATABASE=lumiere_cov05d_20261011212115 make e2e-single E2E_SPEC=cov05d-purchase-receipt-recovery.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05d-20261011212115
```

Safety environment, applied to every command:

- `E2E_STDB_HOST=http://127.0.0.1:3000`.
- `E2E_STDB_CLI_CONFIG=.tmp/e2e/cov05d-run-20261011212115/cli.toml`
  (absolute path at execution). A temporary `spacetime` wrapper prepended via
  `E2E_PATH` supplied this same `--config-path` to all CLI calls, not just login.
- The wrapper added `--non-interactive --data-dir
  .tmp/e2e/cov05d-run-20261011212115/stdb-data` to local server startup.
  Thus global CLI login and existing STDB data were not modified.
- Ports were verified free before startup; before switching modules, the API
  listener was checked against the PID of the service started by this run.
- `.env.local` was checked to preserve the selected `PG_DATABASE` and local
  PostgreSQL host. No environment contents or credentials were printed.
- The application role lacked `CREATEDB`. The existing authenticated local
  development role created only the new databases with the application role as
  owner; no role grants were changed.

The names above now belong to this completed run. Use new names for another
fresh-stack acceptance run rather than assuming these are empty.

### Integrated checks

| Command | Result |
| --- | --- |
| `cd frontend/packages/erp-workflows && pnpm test` | 171 passed, 0 failed/skipped |
| `cd frontend/packages/erp-workflows && pnpm typecheck` | Passed |
| `cd frontend/packages/query-hooks && pnpm test` | 288 passed, 0 failed/skipped |
| `cd frontend/packages/query-hooks && pnpm typecheck` | Passed |
| `cd frontend/web && pnpm typecheck` | Passed |
| Playwright `--project=unauthenticated --list` for the four COV-05 specs | Four tests discovered |
| `git diff --check` | Passed |

Review corrections covered all 500–599 response classifications, strict boolean
and state agreement, nonnegative canonical decimal quantities, and singular
canonical table names in record refs. The Sales command test was aligned with the
same shared 503 reconciliation rule; no Sales production behavior fork was added.

### Failures observed and resolved

1. The delegated isolated checkout lacked frontend dependencies. The integrated
   checkout had them; no dependency/global-tool installation was required.
2. The new stock-ref unit assertion expected a query resource instead of the
   canonical `stock_picking` table. The service ref was also corrected to
   `purchase_order_line`; integrated tests then passed.
3. The initial full query-hook suite retained an old Sales expectation that 503
   was safe to retry. Its test now requires typed reconciliation.
4. The first recovery browser run reached the recovered receipt but asserted
   internal `product_uom_qty_done`, absent from the released stock-moves query
   projection. The proof now uses the released `quantity_done`, exact PO-line
   received delta, and destination-stock delta. No contract or generated file was
   changed; the final recovery gate passed.
5. Reusing the earlier a module for a final setup rerun failed the reset-token
   tenant-isolation domain fixture before browser execution. New dedicated
   `_final` a/b databases/modules passed their full setup and browser gates.
   This is not evidence that setup's domain fixtures are safe to rerun on an
   already-used module.

### Integrated service/storage ledger

- Started only run-owned local SpacetimeDB and API processes; Makefile managed
  each temporary Next.js process. All test listeners were stopped after validation.
- Retained six newly created PostgreSQL databases:
  `lumiere_cov05{a,b,c,d}_20261011212115` and
  `lumiere_cov05{a,b}_20261011212115_final`.
  Native PostgreSQL and unrelated existing services/databases were left running.
- STDB modules/data and local logs remain under the dedicated ignored run
  directory. No cloud publication, global login change, database drop, data wipe,
  or package publication was performed.
- `.tmp/e2e/env.sh` and the private CLI configuration contain credentials.
  They are ignored local runtime state: never commit, attach, or print them.
- Runtime logs are local artifacts, not committed operator recordings. The
  checked-in specs/evidence describe the exact assertions and outcomes.

## Earlier isolated-agent preflight (superseded)

**BLOCKED at frontend dependency inspection; no runtime gate passed.**

This is independent baseline evidence for source HEAD
`98b51190ccfa2c7a7238f9e80c4049550defcbbe`, not acceptance of forthcoming
COV-05d implementation or spec changes in other isolated worktrees.
No shared-plan promotion or production/test source change is made.

The checkout already had an unrelated modification to `frontend/web/next-env.d.ts`
and two untracked Python bytecode files under `scripts/__pycache__/`.
Those files were not changed by this acceptance work.

## Actual prerequisite checks

Commands were bounded with the terminal tool's 10–15 second timeout.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | SHA above |
| `git --no-optional-locks status --short` | Existing unrelated changes described above |
| `docker info --format '{{.ServerVersion}}'` | Failed: configured OrbStack Docker socket does not exist |
| `spacetime version` | Invalid invocation; usage only, not version evidence |
| `spacetime --version` | CLI/library 2.8.2, commit `524b4487d949b61a07d4f39c862d1290259dfd20` |
| `command -v pnpm; command -v cargo; command -v rustup; command -v wasm-tools` | All available |
| `command -v timeout; command -v gtimeout` | Neither available; do not install OS packages to supply them |
| `lsof -nP -iTCP:3000 -iTCP:3100 -iTCP:8082 -iTCP:5432 -sTCP:LISTEN` | Only native PostgreSQL on loopback 5432, PID 2331 |
| `pg_isready -h 127.0.0.1 -p 5432` | Accepting connections |
| `psql -h 127.0.0.1 -p 5432 -d postgres -w -Atc "SELECT datname FROM pg_database WHERE datname IN ('lumiere_cov05_e2e','lumiere_cov05b_e2e','lumiere_cov05c_e2e','lumiere_cov05d_e2e')"` | Exit 0; returned `lumiere_cov05_e2e` |

The documented COV-05a PostgreSQL name already exists and was not created by
this run. Its ownership/data must not be assumed: do not reuse, clear, drop,
or migrate that database. The parent subsequently authorized timestamp-suffixed
fresh dedicated local names as explicit substitutions for the documented names.
That resolves the naming obstacle without touching the existing database.
The b/c/d names were absent from this catalog probe.

The subsequent direct prerequisite check
`test -d frontend/web/node_modules && echo 'frontend node_modules present' || echo 'frontend node_modules absent'; test -d frontend/web/node_modules/@playwright/test && echo 'Playwright dependency present' || echo 'Playwright dependency absent'; git diff --check`
returned exit 0 with **frontend node_modules absent** and **Playwright dependency
absent**. `git diff --check` passed. This isolated checkout cannot run the
documented frontend seed/browser commands with its current dependencies.
No setup was launched and no substituted database/module was created.
The parent reports dependencies in its integrated checkout and can perform
the integrated gates there after merging; this does not constitute a pass here.

Docker's absence alone is not a demonstrated blocker for the native stack.
An unrelated Node listener on 3001 (PID 23131) was observed and left untouched.

## Reference gates inspected by the isolated agent

The three existing status documents' commands were inspected before execution,
as were `Makefile` configuration, `e2e-smoke-setup`, and `e2e-single`.
The original-name commands below were **NOT RUN** by that agent. The integrated
substituted-name runs above supersede its checkout blocker:

```bash
PG_DATABASE=lumiere_cov05_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05-e2e
PG_DATABASE=lumiere_cov05_e2e make e2e-single E2E_SPEC=cov05-purchase-order-confirmation.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05-e2e
PG_DATABASE=lumiere_cov05b_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05b-e2e
PG_DATABASE=lumiere_cov05b_e2e make e2e-single E2E_SPEC=cov05b-purchase-receipt.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05b-e2e
PG_DATABASE=lumiere_cov05c_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05c-e2e
PG_DATABASE=lumiere_cov05c_e2e make e2e-single E2E_SPEC=cov05c-vendor-bill.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05c-e2e
```

## Narrow integrated-run prerequisites

1. Use the merged integrated source, record HEAD and dirty state, and confirm
   the recovery spec and acceptance contract actually exist at that revision.
   This baseline cannot certify another worktree's edits.
2. Provide a fresh dedicated local PostgreSQL instance/catalog where the exact
   names above are absent, or resolve the existing-name blocker with its owner.
   Alternatively use the parent's authorized timestamp-suffixed dedicated names
   and record every actual substituted command explicitly.
   Do not delete the existing user's database. Create only dedicated test
   databases with the intended local role; confirm `PG_HOST`, `PG_PORT`,
   `PG_USER`, and effective database after any local environment sourcing.
   Never print credentials or `.env.local`.
3. Keep 3000, 8082, and 3100 free of unrelated services. Setup can reuse STDB
   and kill an API listener on 8082; do not let it manage unrelated processes.
4. Use a dedicated workspace-private `E2E_STDB_CLI_CONFIG` path rather than
   allowing `scripts/e2e-local-stdb-token.mjs` to read/write the global CLI
   login. Confirm local server resolution with that configuration. Setup's
   publish/describe/call commands use `--server local --no-config`; never
   substitute cloud/default targets.
5. Confirm each STDB module is absent on the dedicated local server before
   initial publish. Never invoke `e2e-local-reset` or delete Docker volumes.
   Clear only a module proven created and owned by this test run, if needed.
6. Verify frontend dependencies, browser availability, Rust/WASM build support,
   and dedicated PostgreSQL permissions. Use bounded setup/test execution
   (terminal tool timeout or an already available bounded process runner);
   a timeout does not automatically clean detached children.
7. Run the exact a/b/c commands above sequentially. `e2e-single` depends on
   `e2e-smoke-setup`, so it repeats setup. Inspect effective database selection
   and ownership before each run and stop only the run-owned API between
   modules. Preserve each run's logs before the next overwrites `.tmp/e2e`.
8. Then run COV-05d using its merged, owner-supplied recovery spec filename:
   `PG_DATABASE=lumiere_cov05d_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05d-e2e`,
   followed by the analogous `make e2e-single E2E_SPEC=<merged recovery spec>
   E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05d-e2e`.
   The placeholder is preparation, not an executable certified gate.
9. Record exact commands, exit status, source identity, UI transition and
   canonical effect identities/cardinality, rejection preserving state,
   recovery and result navigation. Mark ACCEPTED only for the exact tested
   source meeting the full required contract; transport success is insufficient.

## Isolated-agent service, storage, logs, and cleanup ledger

- Services started/owned by this run: **none**.
- Storage mutations: **none**; PostgreSQL catalog inspection was read-only.
- Publish, seed, migration, wipe, login/global-setting changes: **none**.
- Cleanup required for this run: **none**. Existing PostgreSQL/Node services
  and the existing database must be left alone.
- Preflight evidence is captured in the Delta tool transcript and summarized
  here; no runtime log files were produced.
- Future setup writes `.tmp/e2e/spacetime.log`, `.tmp/e2e/api-server.log`,
  hashes/PID markers and `.tmp/e2e/env.sh`. The latter contains secrets:
  never commit, attach, or print it. Preserve sanitized run logs separately.
  Track actual owned PIDs and dedicated databases/modules for scoped cleanup;
  do not infer ownership from a port or stale PID file.
