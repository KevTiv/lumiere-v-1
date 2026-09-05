# Build and CI developer workflow

This guide describes the build-orchestration improvements introduced on
`vibe/c2-postgres-projection-ir-v2`. Production validation remains separate from
the fast local edit/test loop. The API modularization plan is a different
workstream: moving Rust modules alone does not create smaller compilation units.

## Daily local loop

From the repository root, with frontend dependencies and the pinned contracts
staging available:

```sh
make contracts-staging-from-pinned
make e2e-web-dev
```

This prepares the dedicated local E2E database/API, then runs Next development
mode in the foreground on port 3100. In a second terminal:

```sh
make e2e-single-running E2E_SPEC=auth-shell.spec.ts
make e2e-single-running E2E_SPEC=auth-shell.spec.ts E2E_GREP='sign-in'
make e2e-playwright-only E2E_SUITE=p0
```

These test-only commands require healthy services; they do not build, publish,
seed, or install browsers. Install Chromium once if necessary with
`pnpm --dir frontend/web exec playwright install chromium`. Restart the API via
the setup path after Rust changes. Ctrl-C stops the foreground web command;
the setup-managed API and database remain available. Stop the development web
server before running production-build targets on the same port.

For a production-mode regression test:

```sh
make e2e-single E2E_SPEC=auth-shell.spec.ts
E2E_FORCE_REBUILD=1 make e2e-single E2E_SPEC=auth-shell.spec.ts
E2E_SUITE=p0 make e2e-smoke
```

`E2E_CLEAR_DB=1` is destructive: it wipes the selected local database and
reseeds. It is not a build-performance switch. Serial E2E execution remains
the default because tests can mutate shared ERP fixtures.

## What is reused

- API builds select `cargo build -p api-server --bin api-server --locked`.
  Launch uses the native debug executable, not another `cargo run`. Cargo
  metadata resolves the target directory, including `CARGO_TARGET_DIR`.
- Local fingerprints use file contents, names, tool version, and relevant
  environment inputs. API source/shared crates/raw bindings and manifests are
  separate from frontend source/packages/public assets/lockfiles/dotenv files.
  STDB fingerprints include the in-module tests and fixture tooling.
- A local production frontend build is reusable only when its fingerprint and
  recorded `BUILD_ID` match. A failed build clears its stamp. CI always invokes
  the production build; it only reuses compiler intermediates.
- `CONTRACTS_STAGING_DIR` follows the API build script's convention: relative
  paths resolve from `api-server/`. No raw environment values are printed by
  the fingerprint helper. Local stamps are under gitignored `.tmp/e2e/`.
- Turbo caches the web package's `.next` production artifacts, excluding
  compiler cache and development output. Public variables, rewrite/config
  variables, and dotenv files affect the web task hash. Direct `next build`
  does not use Turbo's task cache.

These are native local debug helpers, not cross-compilation or release runners.
Avoid running competing Cargo jobs in the same checkout. A filtered Rust test
still compiles its library; use `--lib` where appropriate to avoid extra test
targets, not as a promise of per-module compilation.

## Reusable CI setup actions

Three composite actions under `.github/actions/` consolidate setup that was
previously inlined in every workflow job:

| Action | Purpose | Replaces |
| --- | --- | --- |
| `setup-contracts-ssh` | Read-only SSH key + known_hosts for the private lumiere-contracts git dependency | 8 identical 11-line inline blocks across all workflows |
| `setup-frontend` | Pinned pnpm 10.31.0 + Node 22 with lockfile-based cache | 5 identical pnpm/Node setup blocks |
| `setup-spacetime-cli` | Cache + install + PATH for the pinned SpacetimeDB CLI | 2 identical cache/install/PATH blocks (ci.yml, e2e-smoke.yml) |

Each workflow passes its own `secrets.LUMIERE_CONTRACTS_DEPLOY_KEY` and
`SPACETIME_CLI_VERSION` as inputs. Permissions, event selection, job
dependencies, and required-gate logic remain at the workflow level. The
composite actions contain only setup steps — no build, test, or deployment.

## CI selection and gates

`scripts/ci-change-scope.py` reads a complete Git merge-base diff. Renames retain
both paths; an empty/unknown/invalid range runs all validation. Tests for the
classifier always run before heavy jobs.

| Change | Main CI work | E2E |
| --- | --- | --- |
| Documentation only (`docs/*.md`/`.adoc`, README/CHANGELOG) | Classifier and gates | Deliberate skip |
| Frontend-only source plus optional docs | Frontend checks, Playwright test listing | P0 on PR; full on main |
| Service Rust source plus optional docs | Service checks/codegen audits/selected tests | P0 on PR; full on main |
| STDB, shared crates, contracts, codegen, manifests, lockfiles, workflows, scripts, unknown or mixed application changes | Full validation | P0 on PR; full on main |
| Scheduled/manual E2E | Separate workflows retain their triggers | Full schedule; manual suite choice |

The standalone SpacetimeDB check runs independently of service compilation.
API library tests do not build every worker test harness. Playwright test
listing shares the frontend dependency installation; the historical
`Playwright (compile smoke)` name remains as a lightweight compatibility gate.

Main runs full E2E once, not overlapping P0 and full jobs. The full suite still
includes P0. PR E2E now considers frontend/shared changes previously excluded
by workflow path filters. Next compiler intermediates are cached separately
from completed build artifacts. Existing Rust, pnpm, browser, and renderer
caches remain; no untrusted cross-run application artifacts are introduced.

**Branch protection requires an administrator action:** prefer the stable
`CI gate` and `E2E gate` checks instead of only a dynamic matrix check. Both
require exact success for selected jobs and exact skipped status for unselected
jobs, rejecting failures, cancellations, and missing outputs. This change does
not edit GitHub branch protection or remove any existing requirement.

## Focused validation

```sh
make e2e-dx-test
node scripts/test-frontend-build-cache.mjs
rustfmt --check api-server/build.rs
bash scripts/test-build-rs-generation.sh
```

The build-generation test uses an already compiled `serde_json` dependency in
`target/debug/deps` and compiles only the small build script. On a fresh checkout,
run the regular dependency/codegen tests first; CI does this automatically.
It does not replace a full API compiler check.

## Measurement and remaining work

Baseline: main [CI run 33911593756](https://github.com/KevTiv/lumiere-v-1/actions/runs/33911593756),
commit `4c5ea33b05d9f423334917949f284fdc117fb028`, September 4, 2026:

| Job | Elapsed |
| --- | ---: |
| Rust | 10m30s |
| Contracts drift | 5m51s |
| Frontend | 4m36s |
| Separate Playwright listing | 38s |
| PDF regression | 1m38s |

This is one observation from another main revision, not a controlled benchmark.
The Rust job included 1m41s STDB checking and 4m33s API test compilation/execution.
Collect comparable warm/cold run timings, queue time, cache transfer time, and
total runner minutes before claiming a percentage improvement.

The following are **not completed by these changes**:

1. Build-once application artifacts shared by isolated E2E shards. First define
   commit/target/toolchain/feature/environment provenance and separate fixture
   creation from compilation. Do not multiply full builds for each shard.
2. Higher E2E worker counts: require persisted fixture-isolation tests first.
3. Realtime/SDK crate extraction: compact contracts are now selected explicitly,
   but the API library still requires full bindings. Workspace feature
   unification still applies when building the API alongside other consumers.
4. Production/test WASM feature separation: requires exact schema/IR/artifact
   provenance and reducer compatibility verification; no schema changes here.
5. Debug/LTO/linker tuning, sccache, larger runners, or broad shared target
   caches: measure separately; no global profile/toolchain change here.
6. Consolidating semantic-index frontend checks: preserve its independent
   trigger/branch coverage until a shared gate guarantees equivalent checks.

Use the [execution ledger](../plan/build-dx-ci-execution-plan.md) for ownership,
review results, and remaining prerequisites.
